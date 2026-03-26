import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRelationships,
  getRelationshipScore,
  updateBidirectionalRelationship,
  getRelationshipLabel,
  buildRelationshipSummary,
  calculateInteractionDelta,
} from '../../src/core/relationship.js';

// Mock agent.js
vi.mock('../../src/core/agent.js', () => ({
  getAgent: vi.fn(),
  listAgents: vi.fn(),
  updateAgent: vi.fn(),
}));

import { getAgent, listAgents, updateAgent } from '../../src/core/agent.js';

describe('Relationship Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================
  // getRelationships
  // ===========================
  describe('getRelationships', () => {
    it('エージェントの全関係性を名前付きで返す', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_kai',
        name: 'Kai',
        relationships: {
          agent_mia: { score: 0.7, lastInteraction: '2026-03-25T10:00:00Z' },
          agent_rex: { score: 0.4, lastInteraction: '2026-03-25T09:00:00Z' },
        },
      });
      listAgents.mockResolvedValue([
        { id: 'agent_kai', name: 'Kai', avatar: '🔬', color: '#4A90D9' },
        { id: 'agent_mia', name: 'Mia', avatar: '✍️', color: '#E91E63' },
        { id: 'agent_rex', name: 'Rex', avatar: '📊', color: '#FF9800' },
      ]);

      const rels = await getRelationships('world1', 'agent_kai');

      expect(rels).toHaveLength(2);
      expect(rels[0]).toEqual({
        agentId: 'agent_mia',
        agentName: 'Mia',
        avatar: '✍️',
        color: '#E91E63',
        score: 0.7,
        label: '友好的',
        lastInteraction: '2026-03-25T10:00:00Z',
      });
      expect(rels[1]).toEqual({
        agentId: 'agent_rex',
        agentName: 'Rex',
        avatar: '📊',
        color: '#FF9800',
        score: 0.4,
        label: '冷淡',
        lastInteraction: '2026-03-25T09:00:00Z',
      });
    });

    it('関係性がないエージェントは空配列を返す', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_kai',
        name: 'Kai',
        relationships: {},
      });
      listAgents.mockResolvedValue([
        { id: 'agent_kai', name: 'Kai', avatar: '🔬', color: '#4A90D9' },
      ]);

      const rels = await getRelationships('world1', 'agent_kai');
      expect(rels).toEqual([]);
    });

    it('relationshipsフィールドがundefinedでも空配列を返す', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_kai',
        name: 'Kai',
      });
      listAgents.mockResolvedValue([]);

      const rels = await getRelationships('world1', 'agent_kai');
      expect(rels).toEqual([]);
    });

    it('エージェントが見つからない場合はnullを返す', async () => {
      getAgent.mockResolvedValue(null);

      const rels = await getRelationships('world1', 'nonexistent');
      expect(rels).toBeNull();
    });
  });

  // ===========================
  // getRelationshipScore
  // ===========================
  describe('getRelationshipScore', () => {
    it('2エージェント間のスコアを返す', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_kai',
        relationships: {
          agent_mia: { score: 0.75, lastInteraction: '2026-03-25T10:00:00Z' },
        },
      });

      const score = await getRelationshipScore('world1', 'agent_kai', 'agent_mia');
      expect(score).toBe(0.75);
    });

    it('関係性がない場合はデフォルト値0.5を返す', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_kai',
        relationships: {},
      });

      const score = await getRelationshipScore('world1', 'agent_kai', 'agent_unknown');
      expect(score).toBe(0.5);
    });
  });

  // ===========================
  // updateBidirectionalRelationship
  // ===========================
  describe('updateBidirectionalRelationship', () => {
    it('両方のエージェントの関係性を更新する', async () => {
      getAgent.mockImplementation(async (worldId, agentId) => {
        if (agentId === 'agent_kai') {
          return {
            id: 'agent_kai',
            relationships: { agent_mia: { score: 0.5, lastInteraction: null } },
          };
        }
        if (agentId === 'agent_mia') {
          return {
            id: 'agent_mia',
            relationships: { agent_kai: { score: 0.5, lastInteraction: null } },
          };
        }
        return null;
      });
      updateAgent.mockResolvedValue();

      await updateBidirectionalRelationship('world1', 'agent_kai', 'agent_mia', 0.05);

      // updateAgentが2回呼ばれること（A→B と B→A）
      expect(updateAgent).toHaveBeenCalledTimes(2);

      // A→B の更新
      const firstCall = updateAgent.mock.calls[0];
      expect(firstCall[0]).toBe('world1');
      expect(firstCall[1]).toBe('agent_kai');
      expect(firstCall[2]['relationships.agent_mia'].score).toBeCloseTo(0.55);

      // B→A の更新
      const secondCall = updateAgent.mock.calls[1];
      expect(secondCall[0]).toBe('world1');
      expect(secondCall[1]).toBe('agent_mia');
      expect(secondCall[2]['relationships.agent_kai'].score).toBeCloseTo(0.55);
    });

    it('スコアは0.0〜1.0にクランプされる', async () => {
      getAgent.mockImplementation(async (worldId, agentId) => {
        if (agentId === 'agent_kai') {
          return { id: 'agent_kai', relationships: { agent_mia: { score: 0.98 } } };
        }
        if (agentId === 'agent_mia') {
          return { id: 'agent_mia', relationships: { agent_kai: { score: 0.98 } } };
        }
        return null;
      });
      updateAgent.mockResolvedValue();

      await updateBidirectionalRelationship('world1', 'agent_kai', 'agent_mia', 0.1);

      const firstCall = updateAgent.mock.calls[0];
      expect(firstCall[2]['relationships.agent_mia'].score).toBe(1.0);
    });

    it('マイナスのdeltaでスコアが下がる', async () => {
      getAgent.mockImplementation(async (worldId, agentId) => {
        if (agentId === 'agent_kai') {
          return { id: 'agent_kai', relationships: { agent_mia: { score: 0.6 } } };
        }
        if (agentId === 'agent_mia') {
          return { id: 'agent_mia', relationships: { agent_kai: { score: 0.6 } } };
        }
        return null;
      });
      updateAgent.mockResolvedValue();

      await updateBidirectionalRelationship('world1', 'agent_kai', 'agent_mia', -0.1);

      const firstCall = updateAgent.mock.calls[0];
      expect(firstCall[2]['relationships.agent_mia'].score).toBeCloseTo(0.5);
    });

    it('関係性が存在しない場合はデフォルト0.5から開始', async () => {
      getAgent.mockImplementation(async (worldId, agentId) => {
        return { id: agentId, relationships: {} };
      });
      updateAgent.mockResolvedValue();

      await updateBidirectionalRelationship('world1', 'agent_kai', 'agent_mia', 0.1);

      const firstCall = updateAgent.mock.calls[0];
      expect(firstCall[2]['relationships.agent_mia'].score).toBeCloseTo(0.6);
    });
  });

  // ===========================
  // getRelationshipLabel
  // ===========================
  describe('getRelationshipLabel', () => {
    it('スコア0.0-0.2は「敵対的」を返す', () => {
      expect(getRelationshipLabel(0.0)).toBe('敵対的');
      expect(getRelationshipLabel(0.1)).toBe('敵対的');
      expect(getRelationshipLabel(0.2)).toBe('敵対的');
    });

    it('スコア0.21-0.4は「冷淡」を返す', () => {
      expect(getRelationshipLabel(0.3)).toBe('冷淡');
      expect(getRelationshipLabel(0.4)).toBe('冷淡');
    });

    it('スコア0.41-0.6は「中立」を返す', () => {
      expect(getRelationshipLabel(0.5)).toBe('中立');
      expect(getRelationshipLabel(0.6)).toBe('中立');
    });

    it('スコア0.61-0.8は「友好的」を返す', () => {
      expect(getRelationshipLabel(0.7)).toBe('友好的');
      expect(getRelationshipLabel(0.8)).toBe('友好的');
    });

    it('スコア0.81-1.0は「親密」を返す', () => {
      expect(getRelationshipLabel(0.9)).toBe('親密');
      expect(getRelationshipLabel(1.0)).toBe('親密');
    });
  });

  // ===========================
  // buildRelationshipSummary
  // ===========================
  describe('buildRelationshipSummary', () => {
    it('エージェントの関係性をプロンプト用テキストで返す', () => {
      const agent = {
        name: 'Kai',
        relationships: {
          agent_mia: { score: 0.8 },
          agent_rex: { score: 0.3 },
        },
      };
      const agentMap = {
        agent_mia: { name: 'Mia' },
        agent_rex: { name: 'Rex' },
      };

      const summary = buildRelationshipSummary(agent, agentMap);

      expect(summary).toContain('Mia');
      expect(summary).toContain('友好的');
      expect(summary).toContain('Rex');
      expect(summary).toContain('冷淡');
    });

    it('関係性がない場合は空文字列を返す', () => {
      const agent = { name: 'Kai', relationships: {} };
      const summary = buildRelationshipSummary(agent, {});
      expect(summary).toBe('');
    });
  });

  // ===========================
  // calculateInteractionDelta
  // ===========================
  describe('calculateInteractionDelta', () => {
    it('ポジティブなセンチメントは正のdeltaを返す', () => {
      const delta = calculateInteractionDelta('positive');
      expect(delta).toBeGreaterThan(0);
    });

    it('ネガティブなセンチメントは負のdeltaを返す', () => {
      const delta = calculateInteractionDelta('negative');
      expect(delta).toBeLessThan(0);
    });

    it('中立なセンチメントは小さな正のdeltaを返す', () => {
      const delta = calculateInteractionDelta('neutral');
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThanOrEqual(0.02);
    });

    it('不明なセンチメントはデフォルトのdeltaを返す', () => {
      const delta = calculateInteractionDelta(undefined);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThanOrEqual(0.02);
    });
  });
});
