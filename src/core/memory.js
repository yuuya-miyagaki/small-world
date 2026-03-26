import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';
import { summarize } from '../services/hfService.js';

/** 短期記憶の統合閾値 */
const CONSOLIDATION_THRESHOLD = 10;

/**
 * 短期記憶を追加する
 * @param {string} worldId
 * @param {string} agentId
 * @param {Object} memory - { content, type, source, channelId }
 * @returns {Promise<Object>} 作成された記憶
 */
export async function addShortTermMemory(worldId, agentId, memory) {
  const db = getFirebaseDb();
  const ref = doc(collection(db, `worlds/${worldId}/agents/${agentId}/shortTermMemories`));

  const memoryDoc = {
    id: ref.id,
    content: memory.content,
    type: memory.type || 'conversation',   // conversation | observation | action
    source: memory.source || 'unknown',
    channelId: memory.channelId || null,
    importance: memory.importance || 0.5,
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, memoryDoc);
  return { ...memoryDoc, id: ref.id };
}

/**
 * 直近 N 件の短期記憶を取得する
 * @param {string} worldId
 * @param {string} agentId
 * @param {number} [count=10] - 取得件数
 * @returns {Promise<Array<Object>>}
 */
export async function getRecentMemories(worldId, agentId, count = 10) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/agents/${agentId}/shortTermMemories`),
    orderBy('createdAt', 'desc'),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * 統合が必要かどうかチェックする
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<boolean>}
 */
export async function checkConsolidationNeeded(worldId, agentId) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/agents/${agentId}/shortTermMemories`)
  );
  const snap = await getDocs(q);
  return snap.size >= CONSOLIDATION_THRESHOLD;
}

/**
 * 短期記憶を要約して長期記憶に統合する
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<Object|null>} 作成された長期記憶
 */
export async function consolidateMemories(worldId, agentId) {
  const shortTermMemories = await getRecentMemories(worldId, agentId, CONSOLIDATION_THRESHOLD);

  if (shortTermMemories.length < 3) return null;

  // 短期記憶を結合してテキスト化
  const combinedText = shortTermMemories
    .reverse()
    .map((m) => m.content)
    .join('\n');

  // HF で要約
  let summaryText;
  try {
    summaryText = await summarize(combinedText, { maxLength: 100 });
  } catch (error) {
    // HF 要約失敗時は先頭と末尾から簡易要約を生成
    console.warn('[Memory] HF summarization failed, using fallback:', error.message);
    summaryText = `${shortTermMemories[0]?.content?.slice(0, 50)}... (他${shortTermMemories.length - 1}件の記憶を統合)`;
  }

  // 長期記憶として保存
  const db = getFirebaseDb();
  const longRef = doc(collection(db, `worlds/${worldId}/agents/${agentId}/longTermMemories`));

  const longTermMemory = {
    id: longRef.id,
    summary: summaryText,
    sourceCount: shortTermMemories.length,
    keywords: extractKeywords(combinedText),
    importance: calculateImportance(shortTermMemories),
    createdAt: serverTimestamp(),
  };

  await setDoc(longRef, longTermMemory);

  // 統合済みの短期記憶をクリア
  await clearConsolidatedShortTerm(worldId, agentId, shortTermMemories);

  return longTermMemory;
}

/**
 * 長期記憶からキーワードで検索する
 * @param {string} worldId
 * @param {string} agentId
 * @param {string} queryText - 検索クエリ
 * @param {number} [count=5] - 取得件数
 * @returns {Promise<Array<Object>>}
 */
export async function recallMemories(worldId, agentId, queryText, count = 5) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/agents/${agentId}/longTermMemories`),
    orderBy('importance', 'desc'),
    limit(count)
  );
  const snap = await getDocs(q);
  const memories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // 簡易キーワードマッチング（将来的にはセマンティック検索に置き換え）
  if (queryText) {
    const queryWords = queryText.toLowerCase().split(/\s+/);
    return memories
      .map((m) => {
        const matchScore = queryWords.reduce((score, word) => {
          if (m.keywords?.some((k) => k.includes(word))) score += 1;
          if (m.summary?.toLowerCase().includes(word)) score += 0.5;
          return score;
        }, 0);
        return { ...m, matchScore };
      })
      .filter((m) => m.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, count);
  }

  return memories;
}

/**
 * 統合済みの短期記憶を削除する
 * @param {string} worldId
 * @param {string} agentId
 * @param {Array<Object>} memories - 削除する記憶の配列
 */
async function clearConsolidatedShortTerm(worldId, agentId, memories) {
  const db = getFirebaseDb();
  const promises = memories.map((m) =>
    deleteDoc(doc(db, `worlds/${worldId}/agents/${agentId}/shortTermMemories`, m.id))
  );
  await Promise.all(promises);
}

/**
 * テキストから簡易キーワードを抽出する
 * @param {string} text
 * @returns {Array<string>}
 */
function extractKeywords(text) {
  // 日本語 + 英語の基本的なキーワード抽出
  const words = text
    .toLowerCase()
    .replace(/[^\w\s\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // 頻出単語を抽出（ストップワード除外）
  const stopWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'has', 'have']);
  const freq = {};
  for (const word of words) {
    if (!stopWords.has(word)) {
      freq[word] = (freq[word] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * 記憶群の重要度を計算する
 * @param {Array<Object>} memories
 * @returns {number} 0.0-1.0
 */
function calculateImportance(memories) {
  if (memories.length === 0) return 0;
  const avgImportance = memories.reduce((sum, m) => sum + (m.importance || 0.5), 0) / memories.length;
  return Math.min(1, avgImportance * (1 + Math.log2(memories.length) * 0.1));
}

export { CONSOLIDATION_THRESHOLD };
