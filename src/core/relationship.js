import { getAgent, listAgents, updateAgent } from './agent.js';

/**
 * 関係性のラベル定義
 * @type {Array<{max: number, label: string}>}
 */
const RELATIONSHIP_LABELS = [
  { max: 0.2, label: '敵対的' },
  { max: 0.4, label: '冷淡' },
  { max: 0.6, label: '中立' },
  { max: 0.8, label: '友好的' },
  { max: 1.0, label: '親密' },
];

/**
 * センチメントごとの関係性変化量
 * @type {Object<string, number>}
 */
const SENTIMENT_DELTAS = {
  positive: 0.05,
  neutral: 0.01,
  negative: -0.03,
};

/**
 * スコアに対応する関係性ラベルを返す
 * @param {number} score - 0.0〜1.0
 * @returns {string}
 */
export function getRelationshipLabel(score) {
  for (const { max, label } of RELATIONSHIP_LABELS) {
    if (score <= max) return label;
  }
  return '親密';
}

/**
 * センチメントから関係性の変化量を計算する
 * @param {string} [sentiment] - 'positive' | 'neutral' | 'negative'
 * @returns {number} delta (-1.0 ~ 1.0)
 */
export function calculateInteractionDelta(sentiment) {
  return SENTIMENT_DELTAS[sentiment] ?? SENTIMENT_DELTAS.neutral;
}

/**
 * エージェントの全関係性を名前・アバター付きで取得する
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<Array<Object>|null>}
 */
export async function getRelationships(worldId, agentId) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) return null;

  const relationships = agent.relationships || {};
  const entries = Object.entries(relationships);
  if (entries.length === 0) return [];

  // ワールド内の全エージェントを取得して名前マップを作成
  const allAgents = await listAgents(worldId);
  const agentMap = Object.fromEntries(
    allAgents.map((a) => [a.id, a])
  );

  return entries.map(([otherId, rel]) => {
    const other = agentMap[otherId];
    return {
      agentId: otherId,
      agentName: other?.name || otherId,
      avatar: other?.avatar || '🤖',
      color: other?.color || '#6366f1',
      score: rel.score ?? 0.5,
      label: getRelationshipLabel(rel.score ?? 0.5),
      lastInteraction: rel.lastInteraction || null,
    };
  });
}

/**
 * 2エージェント間の関係性スコアを取得する
 * @param {string} worldId
 * @param {string} agentId
 * @param {string} otherAgentId
 * @returns {Promise<number>} 0.0〜1.0 (デフォルト: 0.5)
 */
export async function getRelationshipScore(worldId, agentId, otherAgentId) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) return 0.5;
  return agent.relationships?.[otherAgentId]?.score ?? 0.5;
}

/**
 * 2エージェント間の関係性を双方向で更新する
 * @param {string} worldId
 * @param {string} agentIdA
 * @param {string} agentIdB
 * @param {number} delta - スコア変化量 (-1.0 ~ 1.0)
 * @returns {Promise<void>}
 */
export async function updateBidirectionalRelationship(worldId, agentIdA, agentIdB, delta) {
  const [agentA, agentB] = await Promise.all([
    getAgent(worldId, agentIdA),
    getAgent(worldId, agentIdB),
  ]);

  const now = new Date().toISOString();

  // A → B の更新
  const scoreAB = agentA?.relationships?.[agentIdB]?.score ?? 0.5;
  const newScoreAB = Math.max(0, Math.min(1, scoreAB + delta));
  await updateAgent(worldId, agentIdA, {
    [`relationships.${agentIdB}`]: {
      score: newScoreAB,
      lastInteraction: now,
    },
  });

  // B → A の更新
  const scoreBA = agentB?.relationships?.[agentIdA]?.score ?? 0.5;
  const newScoreBA = Math.max(0, Math.min(1, scoreBA + delta));
  await updateAgent(worldId, agentIdB, {
    [`relationships.${agentIdA}`]: {
      score: newScoreBA,
      lastInteraction: now,
    },
  });
}

/**
 * エージェントの関係性をプロンプト用テキストに変換する
 * @param {Object} agent - エージェントオブジェクト
 * @param {Object} agentMap - { agentId: { name } } のマップ
 * @returns {string} プロンプト用の関係性テキスト
 */
export function buildRelationshipSummary(agent, agentMap) {
  const relationships = agent.relationships || {};
  const entries = Object.entries(relationships);
  if (entries.length === 0) return '';

  const lines = entries.map(([otherId, rel]) => {
    const name = agentMap[otherId]?.name || otherId;
    const label = getRelationshipLabel(rel.score ?? 0.5);
    const score = Math.round((rel.score ?? 0.5) * 100);
    return `- ${name}: ${label} (${score}%)`;
  });

  return `他のメンバーとの関係:\n${lines.join('\n')}`;
}
