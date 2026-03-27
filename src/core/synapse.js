/**
 * Synapse — 記憶強化モジュール (Phase 2a)
 *
 * 既存の memory.js（短期→長期の統合）を補完する上位レイヤー:
 *
 * 1. エピソード記憶: 会話の「場面」を構造化して保存
 * 2. セマンティック検索: LLMで関連記憶を検索・スコアリング
 * 3. 記憶の忘却: アクセス頻度と経過時間に基づく自然な減衰
 * 4. 文脈注入: プロンプトに関連記憶を自動挿入するヘルパー
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';
import { chat } from '../services/aiService.js';

/**
 * 忘却（減衰）の設定
 */
export const DECAY_CONFIG = {
  /** 減衰を開始する最低経過日数 */
  MIN_AGE_DAYS: 3,
  /** 1回の減衰で失われる重要度（0-1） */
  DECAY_RATE: 0.1,
  /** この回数以上アクセスされた記憶は減衰しない */
  ACCESS_PROTECTION_THRESHOLD: 5,
  /** この重要度以下になった記憶は削除候補 */
  DELETION_THRESHOLD: 0.1,
};

/**
 * エピソード記憶を作成する
 *
 * 「誰と・何について・どういう結果で・どんな感情か」を構造化して保存。
 *
 * @param {string} worldId
 * @param {string} agentId
 * @param {Object} episode
 * @param {string[]} episode.participants - 参加者ID
 * @param {string} episode.topic - トピック
 * @param {string} episode.content - 内容の要約
 * @param {string} [episode.outcome] - 結果・結論
 * @param {string} [episode.emotionalTone] - 感情トーン
 * @param {string} [episode.channelId] - チャンネルID
 * @returns {Promise<Object>} 作成されたエピソード
 */
export async function createEpisode(worldId, agentId, episode) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, `worlds/${worldId}/agents/${agentId}/episodes`));

  const episodeDoc = {
    id: ref.id,
    participants: episode.participants || [],
    topic: episode.topic,
    content: episode.content,
    outcome: episode.outcome || null,
    emotionalTone: episode.emotionalTone || 'neutral',
    channelId: episode.channelId || null,
    importance: episode.importance || 0.5,
    accessCount: 0,
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, episodeDoc);
  return { ...episodeDoc, id: ref.id };
}

/**
 * LLMベースのセマンティック検索でエピソードを想起する
 *
 * ステップ:
 * 1. 全エピソードを取得（importance順）
 * 2. LLMに「クエリとの関連度スコア」を返させる
 * 3. スコア順にソート、上位を返す
 * 4. アクセスされたエピソードの accessCount を更新
 *
 * @param {string} worldId
 * @param {string} agentId
 * @param {string} queryText - 検索クエリ
 * @param {number} [topK=3] - 返すエピソード数
 * @returns {Promise<Array<Object>>}
 */
export async function recallRelevantEpisodes(worldId, agentId, queryText, topK = 3) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/agents/${agentId}/episodes`),
    orderBy('importance', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  const episodes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (episodes.length === 0) return [];

  // LLMでセマンティックスコアリング
  let scored;
  try {
    scored = await scoreWithLLM(episodes, queryText);
  } catch {
    // LLM失敗時はキーワードフォールバック
    scored = scoreWithKeywords(episodes, queryText);
  }

  const topEpisodes = scored
    .filter((e) => e.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);

  // アクセスカウント更新
  for (const ep of topEpisodes) {
    try {
      const epRef = doc(db, `worlds/${worldId}/agents/${agentId}/episodes`, ep.id);
      await updateDoc(epRef, { accessCount: (ep.accessCount || 0) + 1 });
    } catch {
      // 更新失敗は無視
    }
  }

  return topEpisodes;
}

/**
 * LLMでエピソードの関連度をスコアリング
 */
async function scoreWithLLM(episodes, queryText) {
  const episodeSummaries = episodes.map((e, i) =>
    `[${i}] ${e.topic}: ${e.content}`
  ).join('\n');

  const messages = [
    {
      role: 'system',
      content: 'あなたは記憶の関連度を判定するアシスタントです。与えられたエピソード一覧と検索クエリの関連度を0.0〜1.0のスコアで返してください。JSON形式で {"scores": [0.9, 0.1, ...]} と返してください。',
    },
    {
      role: 'user',
      content: `検索クエリ: ${queryText}\n\nエピソード:\n${episodeSummaries}`,
    },
  ];

  const response = await chat(messages, { temperature: 0, maxTokens: 256 });

  // JSONパース
  const match = response.match(/\{[\s\S]*"scores"[\s\S]*\}/);
  if (!match) throw new Error('Invalid LLM response format');

  const parsed = JSON.parse(match[0]);
  return episodes.map((ep, i) => ({
    ...ep,
    relevanceScore: parsed.scores[i] ?? 0,
  }));
}

/**
 * キーワードベースのフォールバックスコアリング
 */
function scoreWithKeywords(episodes, queryText) {
  const queryWords = queryText.toLowerCase().split(/\s+/);

  return episodes.map((ep) => {
    const text = `${ep.topic} ${ep.content}`.toLowerCase();
    const matchCount = queryWords.filter((w) => text.includes(w)).length;
    return {
      ...ep,
      relevanceScore: matchCount / Math.max(queryWords.length, 1),
    };
  });
}

/**
 * エピソード配列からプロンプトに注入する記憶文脈テキストを生成
 *
 * @param {Array<Object>} episodes - 関連エピソード
 * @returns {string} プロンプト文脈
 */
export function buildMemoryContext(episodes) {
  if (!episodes || episodes.length === 0) return '';

  const lines = episodes.map((ep) => {
    const participants = ep.participants?.join(', ') || '不明';
    const tone = ep.emotionalTone || 'neutral';
    return `- 【${ep.topic}】${ep.content}（参加者: ${participants}、感情: ${tone}）`;
  });

  return `\n【関連する記憶】\n${lines.join('\n')}\n`;
}

/**
 * 記憶の忘却（減衰）を実行
 *
 * - 一定期間アクセスされていない記憶の importance を減衰
 * - ACCESS_PROTECTION_THRESHOLD 以上アクセスされた記憶は保護
 * - DELETION_THRESHOLD 以下になった記憶は将来的に削除候補
 *
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<number>} 減衰させた記憶の数
 */
export async function decayMemories(worldId, agentId) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/agents/${agentId}/episodes`),
    orderBy('importance', 'desc')
  );
  const snap = await getDocs(q);
  const episodes = snap.docs.map((d) => ({
    id: d.id,
    ref: d.ref || doc(db, `worlds/${worldId}/agents/${agentId}/episodes`, d.id),
    ...d.data(),
  }));

  const now = Date.now();
  let decayedCount = 0;

  for (const ep of episodes) {
    // アクセス保護
    if ((ep.accessCount || 0) >= DECAY_CONFIG.ACCESS_PROTECTION_THRESHOLD) {
      continue;
    }

    // 経過日数チェック
    const createdAt = ep.createdAt instanceof Date
      ? ep.createdAt.getTime()
      : new Date(ep.createdAt).getTime();

    const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    if (ageDays < DECAY_CONFIG.MIN_AGE_DAYS) {
      continue;
    }

    // 減衰適用
    const newImportance = Math.max(0, (ep.importance || 0.5) - DECAY_CONFIG.DECAY_RATE);

    try {
      await updateDoc(ep.ref, { importance: newImportance });
      decayedCount++;
    } catch {
      // 更新失敗は無視
    }
  }

  return decayedCount;
}
