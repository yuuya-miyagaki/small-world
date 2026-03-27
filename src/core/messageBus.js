import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';
import { chat, chatStream } from '../services/aiService.js';
import { generateSystemPrompt, analyzeSentimentLocal, detectConversationPhase } from './personality.js';
import { addShortTermMemory, getRecentMemories, recallMemories, checkConsolidationNeeded, consolidateMemories } from './memory.js';
import { getAgent, updateMood, updateAgent, listAgents } from './agent.js';
import { updateBidirectionalRelationship, calculateInteractionDelta } from './relationship.js';
import { recallRelevantEpisodes, buildMemoryContext, createEpisode } from './synapse.js';

/**
 * チャンネルを作成する
 * @param {string} worldId
 * @param {Object} channelData - { name, type, members }
 * @returns {Promise<Object>}
 */
export async function createChannel(worldId, channelData) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, `worlds/${worldId}/channels`));

  const channel = {
    id: ref.id,
    name: channelData.name,
    type: channelData.type || 'group',    // group | dm
    members: channelData.members || [],   // メンバーID配列
    lastMessage: null,
    messageCount: 0,
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, channel);
  return { ...channel, id: ref.id };
}

/**
 * チャンネル一覧を取得する
 * @param {string} worldId
 * @returns {Promise<Array<Object>>}
 */
export async function listChannels(worldId) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/channels`),
    orderBy('createdAt', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * メッセージを送信する
 * @param {string} worldId
 * @param {string} channelId
 * @param {Object} message - { content, senderId, senderName, senderType }
 * @returns {Promise<Object>} 送信されたメッセージ
 */
export async function sendMessage(worldId, channelId, message) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, `worlds/${worldId}/channels/${channelId}/messages`));

  const msg = {
    id: ref.id,
    content: message.content,
    senderId: message.senderId,
    senderName: message.senderName || 'Unknown',
    senderType: message.senderType || 'user',  // user | agent
    metadata: {
      sentiment: null,
      emotion: null,
    },
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, msg);

  // チャンネルの最終メッセージを更新
  const channelRef = doc(db, `worlds/${worldId}/channels`, channelId);
  await setDoc(channelRef, {
    lastMessage: {
      content: message.content.slice(0, 100),
      senderName: msg.senderName,
      createdAt: new Date().toISOString(),
    },
    messageCount: (await getMessages(worldId, channelId, { limit: 1 })).length, // 簡易カウント
  }, { merge: true });

  return { ...msg, id: ref.id };
}

/**
 * メッセージ一覧を取得する
 * @param {string} worldId
 * @param {string} channelId
 * @param {Object} [options] - { limit: number }
 * @returns {Promise<Array<Object>>}
 */
export async function getMessages(worldId, channelId, options = {}) {
  const db = getFirebaseDb();
  const constraints = [orderBy('createdAt', 'asc')];
  if (options.limit) constraints.push(limit(options.limit));

  const q = query(
    collection(db, `worlds/${worldId}/channels/${channelId}/messages`),
    ...constraints
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * チャンネルのメッセージをリアルタイム購読する
 * @param {string} worldId
 * @param {string} channelId
 * @param {Function} callback - メッセージ配列を受け取るコールバック
 * @returns {Function} unsubscribe 関数
 */
export function subscribeToChannel(worldId, channelId, callback) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/channels/${channelId}/messages`),
    orderBy('createdAt', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(messages);
  });
}

/**
 * エージェントがメッセージに応答するメインフロー
 * 応答生成→即座投稿→バックグラウンドで感情分析・記憶・関係性更新
 * @param {string} worldId
 * @param {string} agentId - 応答するエージェントのID
 * @param {string} channelId - チャンネルID
 * @param {Object} incomingMessage - 受信メッセージ
 * @param {Object} [options] - 追加オプション
 * @param {Function} [options.onChunk] - ストリーミング時のチャンクコールバック
 * @returns {Promise<Object>} エージェントの応答メッセージ
 */
export async function handleAgentResponse(worldId, agentId, channelId, incomingMessage, options = {}) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // 1. 受信メッセージを短期記憶に保存
  await addShortTermMemory(worldId, agentId, {
    content: `${incomingMessage.senderName}: ${incomingMessage.content}`,
    type: 'conversation',
    source: incomingMessage.senderId,
    channelId,
  });

  // 2. 記憶検索を並列実行（短期記憶書き込み後に開始 → 整合性を保証）
  let longTermMemories = [];
  let episodeContext = '';
  let recentMemories = [];

  try {
    const [ltm, episodes, recent] = await Promise.all([
      recallMemories(worldId, agentId, incomingMessage.content, 3),
      recallRelevantEpisodes(worldId, agentId, incomingMessage.content, 3).catch(() => []),
      getRecentMemories(worldId, agentId, 5),
    ]);
    longTermMemories = ltm;
    episodeContext = buildMemoryContext(episodes);
    recentMemories = recent;
  } catch (err) {
    console.warn('[MessageBus] Memory retrieval partially failed:', err.message);
  }

  // 3. 会話フェーズ検出（ルールベース）
  const conversationPhase = detectConversationPhase(recentMemories, recentMemories.length);

  // 3b. 他エージェント情報を取得（Firestore 1回読み取り）
  let otherAgents = [];
  try {
    otherAgents = await listAgents(worldId);
  } catch {
    // 他エージェント情報取得失敗は無視
  }

  // 4. システムプロンプト構築（フェーズ + 他エージェント視点 + エピソード記憶を注入）
  const systemPrompt = generateSystemPrompt(agent, {
    memories: longTermMemories,
    relationships: agent.relationships || {},
    conversationPhase,
    otherAgents,
  }) + episodeContext;

  // 5. 会話履歴構築（記憶の content は「名前: 発言内容」形式で保存されている）
  const conversationHistory = recentMemories
    .reverse()
    .map((m) => ({
      role: m.content?.startsWith(`${agent.name}:`) ? 'model' : 'user',
      content: m.content,
    }));

  // 6. Gemini API で応答生成
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: `${incomingMessage.senderName}: ${incomingMessage.content}` },
  ];

  let responseText;
  try {
    if (options.onChunk) {
      // ストリーミングモード: チャンクをUIにリアルタイム送信
      responseText = await chatStream(messages, {
        temperature: 0.6 + agent.personality.openness * 0.3,
        maxTokens: 512,
        onChunk: options.onChunk,
      });
    } else {
      // 通常モード: 一括応答
      responseText = await chat(messages, {
        temperature: 0.6 + agent.personality.openness * 0.3,
        maxTokens: 512,
      });
    }
  } catch (error) {
    console.error(`[MessageBus] Agent ${agent.name} response generation failed:`, error);
    responseText = generateFallbackResponse(agent, incomingMessage);
  }

  // 7. 応答をチャンネルに投稿（ストリーミング完了後に一括書き込み）
  const responseMessage = await sendMessage(worldId, channelId, {
    content: responseText,
    senderId: agentId,
    senderName: agent.name,
    senderType: 'agent',
  });

  // 8. バックグラウンド処理（感情分析・記憶・関係性・統計）
  processPostResponse(worldId, agentId, channelId, agent, responseText, incomingMessage).catch(
    (err) => console.warn(`[MessageBus] Background processing failed for ${agent.name}:`, err.message)
  );

  return responseMessage;
}

/**
 * 応答投稿後のバックグラウンド処理
 */
async function processPostResponse(worldId, agentId, channelId, agent, responseText, incomingMessage) {
  // 自分の応答を短期記憶に保存
  await addShortTermMemory(worldId, agentId, {
    content: `${agent.name}: ${responseText}`,
    type: 'conversation',
    source: agentId,
    channelId,
  });

  // 感情分析（ルールベース → API call 不要、キュー占有解消）
  const sentimentResult = analyzeSentimentLocal(responseText);
  const dominantSentiment = sentimentResult[0];
  const sentimentLabel = dominantSentiment?.label || 'neutral';
  const sentimentScore = parseSentimentScore(dominantSentiment);
  await updateMood(worldId, agentId, {
    valence: agent.mood.valence * 0.7 + sentimentScore * 0.3,
    energy: Math.max(0.1, agent.mood.energy - 0.02),
    dominantEmotion: sentimentLabel,
  });

  // 関係性更新
  if (incomingMessage.senderId) {
    const delta = calculateInteractionDelta(sentimentLabel);
    await updateBidirectionalRelationship(worldId, agentId, incomingMessage.senderId, delta);
  }

  // 統計更新
  await updateAgent(worldId, agentId, {
    'stats.messagesGenerated': (agent.stats?.messagesGenerated || 0) + 1,
  });

  // 記憶統合チェック
  const needsConsolidation = await checkConsolidationNeeded(worldId, agentId);
  if (needsConsolidation) {
    consolidateMemories(worldId, agentId).catch((err) =>
      console.warn(`[Memory] Consolidation failed: ${err.message}`)
    );
  }

  // エピソード記憶を作成（Synapse）
  try {
    await createEpisode(worldId, agentId, {
      participants: [agentId, incomingMessage.senderId].filter(Boolean),
      topic: incomingMessage.content.slice(0, 50),
      content: `${incomingMessage.senderName}: ${incomingMessage.content} → ${agent.name}: ${responseText.slice(0, 100)}`,
      emotionalTone: sentimentLabel,
      channelId,
    });
  } catch {
    // エピソード作成失敗はスキップ
  }
}

/**
 * センチメント結果からスコアを抽出する（0.0-1.0）
 */
function parseSentimentScore(sentiment) {
  if (!sentiment) return 0.5;

  const label = sentiment.label?.toLowerCase() || '';
  if (label.includes('5') || label.includes('very positive')) return 0.9;
  if (label.includes('4') || label.includes('positive')) return 0.7;
  if (label.includes('3') || label.includes('neutral')) return 0.5;
  if (label.includes('2') || label.includes('negative')) return 0.3;
  if (label.includes('1') || label.includes('very negative')) return 0.1;

  return sentiment.score ?? 0.5;
}

/**
 * API 失敗時のフォールバック応答を生成する
 * ユーザーの質問内容を反映した文脈依存型応答
 * @param {Object} agent
 * @param {Object} incomingMessage - 受信メッセージ（質問内容を反映するため）
 * @returns {string}
 */
function generateFallbackResponse(agent, incomingMessage) {
  const userContent = incomingMessage?.content || '';
  const senderName = incomingMessage?.senderName || '';

  // 質問内容に基づく文脈依存型フォールバック
  const contextual = generateContextualFallback(agent, userContent, senderName);
  if (contextual) return contextual;

  // 汎用フォールバック（文脈判定できない場合のみ）
  const fallbacks = {
    リサーチャー: [
      `${senderName}さん、その話は気になりますね。データを集めてから改めて意見を出させてください。`,
      `なるほど。一度しっかり調べてから、根拠のある回答をしたいですね。`,
    ],
    ライター: [
      `${senderName}さんのその視点、面白いですね。うまく言語化してみたいです。`,
      `その話には色んな角度がありそうですね。どこから切り込みましょうか？`,
    ],
    マネージャー: [
      `${senderName}さん、いい話題ですね。具体的にどう進めたいですか？`,
      `そのテーマで何が一番重要かを一緒に整理しましょう。`,
    ],
    デザイナー: [
      `${senderName}さん、興味深いですね。ユーザー目線だとどう見えるか考えてみたいです。`,
      `その発想、ビジュアル的に表現するとどうなるか気になります。`,
    ],
  };

  const agentFallbacks = fallbacks[agent.role] || [
    `${senderName}さん、その点について自分なりの考えをまとめてみますね。`,
    'もう少し詳しく聞かせてもらえますか？',
    'それは興味深いですね。考えてみます。',
  ];
  return agentFallbacks[Math.floor(Math.random() * agentFallbacks.length)];
}

/**
 * ユーザーの質問内容に基づく文脈依存型フォールバック応答
 * @param {Object} agent
 * @param {string} userContent - ユーザーの入力内容
 * @param {string} senderName - 送信者名
 * @returns {string|null} 文脈依存応答（判定できない場合はnull）
 */
function generateContextualFallback(agent, userContent, senderName) {
  if (!userContent) return null;

  const isQuestion = userContent.includes('？') || userContent.includes('?')
    || userContent.includes('教えて') || userContent.includes('何')
    || userContent.includes('どう') || userContent.includes('なぜ');

  const isOpinionRequest = userContent.includes('意見') || userContent.includes('思い')
    || userContent.includes('思う') || userContent.includes('考え');

  const isTopicAbout = userContent.includes('について') || userContent.includes('に関して');

  // 話題を抽出（「〜について」の前の名詞句を取る）
  let topic = '';
  const aboutMatch = userContent.match(/(.{2,15})(?:について|に関して|の(?:こと|話|トレンド))/);
  if (aboutMatch) topic = aboutMatch[1];

  // ロール別の応答バリエーション（テンプレートの単調さを防ぐ）
  const roleResponses = {
    リサーチャー: {
      question: topic
        ? `${senderName}さん、${topic}は気になるテーマですね。関連するデータや事例を探してみたいです。どの角度から掘り下げましょうか？`
        : `${senderName}さん、その疑問は面白いですね。根拠になるデータを集めてみましょうか。`,
      opinion: `${senderName}さん、研究者の視点で言うと、まず仮説を立てて検証するのが大事だと思います。先行事例を調べてみたいですね。`,
      topic: topic
        ? `${topic}に関しては、いくつかの切り口がありそうです。定量的なデータと定性的な分析、両方の視点で見てみたいですね。`
        : null,
    },
    ライター: {
      question: topic
        ? `${senderName}さん、${topic}って言葉にするのが難しいテーマですよね。ストーリーとして組み立ててみると見えてくるものがありそうです。`
        : `${senderName}さん、いい質問ですね。伝え方を工夫すれば、もっとクリアになりそうです。`,
      opinion: `${senderName}さん、文章を書く人間としては、「誰に何を伝えたいか」を最初に決めるのが大切だと思いますね。`,
      topic: topic
        ? `${topic}を言葉にするなら、読み手の目線に立って構成を考えたいですね。どんな印象を残したいですか？`
        : null,
    },
    マネージャー: {
      question: topic
        ? `${senderName}さん、${topic}については、まず優先度を整理しましょう。何が一番インパクトが大きいと思いますか？`
        : `${senderName}さん、いい論点ですね。チームとして何から手をつけるか決めましょうか。`,
      opinion: `${senderName}さん、マネジメントの観点だと、アクションに落とし込めるかが重要ですね。具体的な次のステップを一緒に考えましょう。`,
      topic: topic
        ? `${topic}は重要なテーマですね。タイムラインとリソースを考慮して、現実的なプランを立てましょうか。`
        : null,
    },
    デザイナー: {
      question: topic
        ? `${senderName}さん、${topic}についてですか。ユーザーがどう感じるか、体験設計の観点で考えてみたいですね。`
        : `${senderName}さん、その問いにはデザイン思考のアプローチが合いそうです。ユーザーの立場で考えてみましょう。`,
      opinion: `${senderName}さん、デザイナーとしては、見た目だけじゃなくて使いやすさや感情面も大切にしたいですね。`,
      topic: topic
        ? `${topic}をデザインの目で見ると、色々な可能性がありますね。プロトタイプを作って試すのが一番早いかもしれません。`
        : null,
    },
    エンジニア: {
      question: topic
        ? `${senderName}さん、${topic}について技術的に言えば、実装コストとメンテナンス性のバランスが鍵ですね。`
        : `${senderName}さん、技術的にどう実現するかを考えてみましょう。パフォーマンスとスケーラビリティが重要ですね。`,
      opinion: `${senderName}さん、エンジニアとしては、シンプルで壊れにくい設計を推したいですね。過度な複雑化は避けたいです。`,
      topic: topic
        ? `${topic}の技術的な実現方法はいくつかパターンがありますね。トレードオフを整理してみましょう。`
        : null,
    },
  };

  const responses = roleResponses[agent.role];

  // ロール固有のテンプレートがない場合の汎用パターン
  if (!responses) {
    if (isQuestion && topic) return `${senderName}さん、${topic}は興味深いテーマですね。もう少し具体的に聞かせてください。`;
    if (isOpinionRequest) return `${senderName}さん、自分の経験から言うと、多角的に検討することが大切だと思いますね。`;
    if (isTopicAbout && topic) return `${topic}について考えてみると、色んな側面がありそうですね。`;
    return null;
  }

  if (isQuestion) return responses.question;
  if (isOpinionRequest) return responses.opinion;
  if (isTopicAbout && responses.topic) return responses.topic;

  return null; // 汎用フォールバックに委譲
}

