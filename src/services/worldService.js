import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';
import { createAgent } from '../core/agent.js';
import { createChannel } from '../core/messageBus.js';
import { PRESET_AGENTS } from '../core/personality.js';

/**
 * 新しいワールドを作成する（プリセットエージェント3体 + General チャンネル付き）
 * @param {string} userId - 作成者のユーザーID
 * @param {string} name - ワールド名
 * @returns {Promise<Object>} 作成されたワールド
 */
export async function createWorld(userId, name) {
  const db = getFirebaseDb();
  const worldRef = doc(collection(db, 'worlds'));

  const world = {
    id: worldRef.id,
    name,
    ownerId: userId,
    agentCount: PRESET_AGENTS.length,
    settings: {
      heartbeatInterval: 30000,  // 30秒
      autoHeartbeat: true,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(worldRef, world);

  // プリセットエージェント3体を作成
  const agents = [];
  for (const preset of PRESET_AGENTS) {
    const agent = await createAgent(worldRef.id, preset);
    agents.push(agent);
  }

  // General チャンネルを作成
  const generalChannel = await createChannel(worldRef.id, {
    name: 'general',
    type: 'group',
    members: agents.map((a) => a.id),
  });

  return { ...world, agents, channels: [generalChannel] };
}

/**
 * ユーザーのワールド一覧を取得する
 * @param {string} userId
 * @returns {Promise<Array<Object>>}
 */
export async function listWorlds(userId) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'worlds'),
    where('ownerId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * ワールドを取得する
 * @param {string} worldId
 * @returns {Promise<Object|null>}
 */
export async function getWorld(worldId) {
  const db = getFirebaseDb();
  const snap = await getDoc(doc(db, 'worlds', worldId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
