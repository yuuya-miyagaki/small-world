import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-agent-id' })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(() => ({ docs: [] })),
  updateDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
}));

vi.mock('../../src/config/firebase.js', () => ({
  getFirebaseDb: vi.fn(() => ({})),
}));

import { setDoc, getDoc, updateDoc } from 'firebase/firestore';

describe('Agent Module', () => {
  let agentModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    agentModule = await import('../../src/core/agent.js');
  });

  describe('createAgent', () => {
    it('should create an agent with default values', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await agentModule.createAgent('world-1', {
        name: 'TestBot',
        role: 'テスター',
      });

      expect(setDoc).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('TestBot');
      expect(result.role).toBe('テスター');
      expect(result.avatar).toBe('🤖');
      expect(result.color).toBe('#6366f1');
      expect(result.status).toBe('idle');
      expect(result.mood.energy).toBe(0.7);
      expect(result.mood.stress).toBe(0.3);
    });

    it('should use provided personality values', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await agentModule.createAgent('world-1', {
        name: 'CustomBot',
        role: 'カスタム',
        personality: {
          openness: 0.9,
          conscientiousness: 0.8,
          extraversion: 0.3,
          agreeableness: 0.7,
          neuroticism: 0.1,
        },
      });

      expect(result.personality.openness).toBe(0.9);
      expect(result.personality.conscientiousness).toBe(0.8);
      expect(result.personality.neuroticism).toBe(0.1);
    });

    it('should default personality to 0.5 when not provided', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await agentModule.createAgent('world-1', {
        name: 'DefaultBot',
        role: 'デフォルト',
      });

      expect(result.personality.openness).toBe(0.5);
      expect(result.personality.conscientiousness).toBe(0.5);
      expect(result.personality.extraversion).toBe(0.5);
    });
  });

  describe('getAgent', () => {
    it('should return agent data when found', async () => {
      getDoc.mockResolvedValue({
        exists: () => true,
        id: 'agent-1',
        data: () => ({ name: 'FoundBot', role: 'テスター' }),
      });

      const result = await agentModule.getAgent('world-1', 'agent-1');
      expect(result).toEqual({ id: 'agent-1', name: 'FoundBot', role: 'テスター' });
    });

    it('should return null when agent not found', async () => {
      getDoc.mockResolvedValue({
        exists: () => false,
      });

      const result = await agentModule.getAgent('world-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateMood', () => {
    it('should clamp mood values between 0 and 1', async () => {
      getDoc.mockResolvedValue({
        exists: () => true,
        id: 'agent-1',
        data: () => ({
          name: 'TestBot',
          role: 'テスター',
          relationships: {},
          stats: {},
        }),
      });
      updateDoc.mockResolvedValue(undefined);

      await agentModule.updateMood('world-1', 'agent-1', {
        energy: 1.5,  // Should be clamped to 1
        stress: -0.3, // Should be clamped to 0
      });

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const updateArgs = updateDoc.mock.calls[0][1];
      expect(updateArgs['mood.energy']).toBe(1);
      expect(updateArgs['mood.stress']).toBe(0);
    });
  });
});
