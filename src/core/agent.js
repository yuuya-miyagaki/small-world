import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';

/**
 * エージェントを作成する
 * @param {string} worldId - ワールドID
 * @param {Object} agentData - エージェントデータ
 * @param {string} agentData.name - 名前
 * @param {string} agentData.role - ロール（researcher, writer, manager 等）
 * @param {string} agentData.avatar - アバター（絵文字）
 * @param {string} agentData.color - テーマカラー（hex）
 * @param {Object} agentData.personality - Big Five 性格パラメータ (0.0-1.0)
 * @param {number} agentData.personality.openness - 開放性
 * @param {number} agentData.personality.conscientiousness - 誠実性
 * @param {number} agentData.personality.extraversion - 外向性
 * @param {number} agentData.personality.agreeableness - 協調性
 * @param {number} agentData.personality.neuroticism - 神経症傾向
 * @returns {Promise<Object>} 作成されたエージェント
 */
export async function createAgent(worldId, agentData) {
  const db = getFirebaseDb();
  const agentRef = doc(collection(db, `worlds/${worldId}/agents`));

  const agent = {
    id: agentRef.id,
    name: agentData.name,
    role: agentData.role,
    avatar: agentData.avatar || '🤖',
    color: agentData.color || '#6366f1',
    personality: {
      openness: agentData.personality?.openness ?? 0.5,
      conscientiousness: agentData.personality?.conscientiousness ?? 0.5,
      extraversion: agentData.personality?.extraversion ?? 0.5,
      agreeableness: agentData.personality?.agreeableness ?? 0.5,
      neuroticism: agentData.personality?.neuroticism ?? 0.5,
    },
    mood: {
      energy: 0.7,
      stress: 0.3,
      valence: 0.6,       // ポジティブ-ネガティブ
      dominantEmotion: 'neutral',
    },
    status: 'idle',        // active | idle | sleeping
    relationships: {},     // { agentId: { score, lastInteraction } }
    stats: {
      messagesGenerated: 0,
      memoriesFormed: 0,
      autonomousActions: 0,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(agentRef, agent);
  return { ...agent, id: agentRef.id };
}

/**
 * エージェントを取得する
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<Object|null>}
 */
export async function getAgent(worldId, agentId) {
  const db = getFirebaseDb();
  const docRef = doc(db, `worlds/${worldId}/agents`, agentId);
  const snap = await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * ワールド内の全エージェントを取得する
 * @param {string} worldId
 * @returns {Promise<Array<Object>>}
 */
export async function listAgents(worldId) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/agents`),
    orderBy('createdAt', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * エージェントを更新する
 * @param {string} worldId
 * @param {string} agentId
 * @param {Object} updates - 更新するフィールド
 * @returns {Promise<void>}
 */
export async function updateAgent(worldId, agentId, updates) {
  const db = getFirebaseDb();
  const docRef = doc(db, `worlds/${worldId}/agents`, agentId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/**
 * エージェントの気分を更新する
 * @param {string} worldId
 * @param {string} agentId
 * @param {Object} moodUpdates - { energy?, stress?, valence?, dominantEmotion? }
 * @returns {Promise<void>}
 */
export async function updateMood(worldId, agentId, moodUpdates) {
  const updates = {};
  for (const [key, value] of Object.entries(moodUpdates)) {
    updates[`mood.${key}`] = typeof value === 'number'
      ? Math.max(0, Math.min(1, value))
      : value;
  }
  await updateAgent(worldId, agentId, updates);
}

/**
 * エージェント同士の関係性スコアを更新する
 * @param {string} worldId
 * @param {string} agentId
 * @param {string} otherAgentId
 * @param {number} delta - スコア変化量 (-1.0 ~ 1.0)
 * @returns {Promise<void>}
 */
export async function updateRelationship(worldId, agentId, otherAgentId, delta) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) return;

  const currentScore = agent.relationships?.[otherAgentId]?.score ?? 0.5;
  const newScore = Math.max(0, Math.min(1, currentScore + delta));

  await updateAgent(worldId, agentId, {
    [`relationships.${otherAgentId}`]: {
      score: newScore,
      lastInteraction: new Date().toISOString(),
    },
  });
}
