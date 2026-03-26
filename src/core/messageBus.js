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
import { chat, analyzeSentiment } from '../services/hfService.js';
import { generateSystemPrompt } from './personality.js';
import { addShortTermMemory, getRecentMemories, recallMemories, checkConsolidationNeeded, consolidateMemories } from './memory.js';
import { getAgent, updateMood, updateRelationship, updateAgent } from './agent.js';

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
 * @param {string} worldId
 * @param {string} agentId - 応答するエージェントのID
 * @param {string} channelId - チャンネルID
 * @param {Object} incomingMessage - 受信メッセージ
 * @returns {Promise<Object>} エージェントの応答メッセージ
 */
export async function handleAgentResponse(worldId, agentId, channelId, incomingMessage) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // 1. 受信メッセージを短期記憶に保存
  await addShortTermMemory(worldId, agentId, {
    content: `${incomingMessage.senderName}: ${incomingMessage.content}`,
    type: 'conversation',
    source: incomingMessage.senderId,
    channelId,
  });

  // 2. 関連する長期記憶を検索
  const longTermMemories = await recallMemories(worldId, agentId, incomingMessage.content, 3);

  // 3. 最近の短期記憶を取得（コンテキストとして）
  const recentMemories = await getRecentMemories(worldId, agentId, 5);

  // 4. システムプロンプト構築
  const systemPrompt = generateSystemPrompt(agent, {
    memories: longTermMemories,
    relationships: agent.relationships || {},
  });

  // 5. 会話履歴構築
  const conversationHistory = recentMemories
    .reverse()
    .map((m) => ({
      role: m.source === agentId ? 'assistant' : 'user',
      content: m.content,
    }));

  // 6. HF API で応答生成
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: `${incomingMessage.senderName}: ${incomingMessage.content}` },
  ];

  let responseText;
  try {
    responseText = await chat(messages, {
      temperature: 0.6 + agent.personality.openness * 0.3,
      maxTokens: 256,
    });
  } catch (error) {
    console.error(`[MessageBus] Agent ${agent.name} response generation failed:`, error);
    responseText = generateFallbackResponse(agent);
  }

  // 7. 感情分析 → 気分更新
  try {
    const sentimentResult = await analyzeSentiment(responseText);
    const dominantSentiment = sentimentResult[0];

    // 感情分析結果を気分に反映
    const sentimentScore = parseSentimentScore(dominantSentiment);
    await updateMood(worldId, agentId, {
      valence: agent.mood.valence * 0.7 + sentimentScore * 0.3,
      energy: Math.max(0.1, agent.mood.energy - 0.02),  // 活動ごとに微減
      dominantEmotion: dominantSentiment?.label || 'neutral',
    });
  } catch (error) {
    console.warn(`[MessageBus] Sentiment analysis failed for ${agent.name}:`, error.message);
  }

  // 8. 応答をチャンネルに投稿
  const responseMessage = await sendMessage(worldId, channelId, {
    content: responseText,
    senderId: agentId,
    senderName: agent.name,
    senderType: 'agent',
  });

  // 9. 自分の応答も短期記憶に保存
  await addShortTermMemory(worldId, agentId, {
    content: `${agent.name}: ${responseText}`,
    type: 'conversation',
    source: agentId,
    channelId,
  });

  // 10. 関係性更新（会話した相手との親密度微増）
  if (incomingMessage.senderId) {
    await updateRelationship(worldId, agentId, incomingMessage.senderId, 0.02);
  }

  // 11. 統計更新
  await updateAgent(worldId, agentId, {
    'stats.messagesGenerated': (agent.stats?.messagesGenerated || 0) + 1,
  });

  // 12. 記憶統合チェック
  const needsConsolidation = await checkConsolidationNeeded(worldId, agentId);
  if (needsConsolidation) {
    consolidateMemories(worldId, agentId).catch((err) =>
      console.warn(`[Memory] Consolidation failed for ${agent.name}:`, err.message)
    );
  }

  return responseMessage;
}

/**
 * センチメント結果からスコアを抽出する（0.0-1.0）
 * nlptown/bert-base-multilingual-uncased-sentiment は "1 star" ~ "5 stars" を返す
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
 * @param {Object} agent
 * @returns {string}
 */
function generateFallbackResponse(agent) {
  const fallbacks = {
    リサーチャー: [
      'うーん、興味深い話題ですね。もう少し詳しく聞かせてください。',
      'それについて調べてみる価値がありますね。',
      '面白い視点です。データを集めてみましょうか？',
      'なるほど、そのテーマは掘り下げがいがありそうです。',
      '確かに、もう少し深く分析してみたいですね。',
    ],
    ライター: [
      'なるほど、面白い視点ですね。まとめてみましょうか。',
      '素敵な発想ですね。形にしてみたいです。',
      'いい切り口ですね。ストーリーとして描けそうです。',
      'そのアイデア、文章にすると映えそうですね。',
      '表現を工夫して伝えてみたいテーマですね。',
    ],
    マネージャー: [
      '了解です。進め方を整理しましょう。',
      'いいですね、まずは優先順位を決めましょう。',
      'チームで取り組む価値がありますね。段取りを考えます。',
      '目標を明確にして、タスクに分解してみましょう。',
      'スケジュール感を確認しながら進めましょうか。',
    ],
  };

  const agentFallbacks = fallbacks[agent.role] || [
    'なるほど、面白いですね。もう少し教えてください。',
    'もう少し詳しく聞かせてもらえますか？',
    'それは興味深いですね。考えてみます。',
  ];
  return agentFallbacks[Math.floor(Math.random() * agentFallbacks.length)];
}
