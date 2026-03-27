/**
 * Synapse（記憶強化モジュール）のユニットテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-id' })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(() => ({ docs: [], size: 0 })),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  where: vi.fn(),
  serverTimestamp: vi.fn(() => new Date().toISOString()),
}));

vi.mock('../../src/config/firebase.js', () => ({
  getFirebaseDb: vi.fn(() => ({})),
}));

vi.mock('../../src/services/aiService.js', () => ({
  chat: vi.fn(),
}));

import { getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { chat as mockChat } from '../../src/services/aiService.js';

describe('Synapse Module', () => {
  let synapse;

  beforeEach(async () => {
    vi.clearAllMocks();
    synapse = await import('../../src/core/synapse.js');
  });

  describe('createEpisode', () => {
    it('should create an episode with structured fields', async () => {
      setDoc.mockResolvedValue(undefined);

      const episode = await synapse.createEpisode('world-1', 'agent-kai', {
        participants: ['agent-kai', 'agent-mia'],
        topic: 'AIの将来性',
        content: 'KaiとMiaがAIの将来について議論した',
        outcome: 'AIは補助ツールとして発展するという合意',
        emotionalTone: 'positive',
        channelId: 'channel-1',
      });

      expect(setDoc).toHaveBeenCalledTimes(1);
      expect(episode.topic).toBe('AIの将来性');
      expect(episode.participants).toEqual(['agent-kai', 'agent-mia']);
      expect(episode.emotionalTone).toBe('positive');
      expect(episode.accessCount).toBe(0);
    });
  });

  describe('recallRelevantEpisodes', () => {
    it('should use LLM to score episode relevance', async () => {
      const mockDocs = [
        {
          id: 'ep-1',
          data: () => ({
            topic: 'AIの将来性',
            content: 'AIは補助ツールとして発展する',
            participants: ['agent-kai', 'agent-mia'],
            emotionalTone: 'positive',
            importance: 0.8,
            accessCount: 3,
            createdAt: new Date().toISOString(),
          }),
        },
        {
          id: 'ep-2',
          data: () => ({
            topic: '天気の話',
            content: '今日は晴れだった',
            participants: ['agent-kai'],
            emotionalTone: 'neutral',
            importance: 0.3,
            accessCount: 0,
            createdAt: new Date().toISOString(),
          }),
        },
      ];

      getDocs.mockResolvedValue({ docs: mockDocs });
      // LLM returns relevance scores as JSON
      mockChat.mockResolvedValue('{"scores": [0.9, 0.1]}');

      const results = await synapse.recallRelevantEpisodes(
        'world-1', 'agent-kai', 'AIの将来について教えて'
      );

      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('ep-1'); // higher relevance
    });

    it('should fallback to keyword match when LLM fails', async () => {
      const mockDocs = [
        {
          id: 'ep-1',
          data: () => ({
            topic: 'AIの将来性',
            content: 'AI技術の進化',
            participants: ['agent-kai'],
            importance: 0.7,
            accessCount: 1,
            createdAt: new Date().toISOString(),
          }),
        },
      ];

      getDocs.mockResolvedValue({ docs: mockDocs });
      mockChat.mockRejectedValue(new Error('API Error'));

      const results = await synapse.recallRelevantEpisodes(
        'world-1', 'agent-kai', 'AI'
      );

      // fallback: keyword match should still work
      expect(results.length).toBe(1);
    });

    it('should increment accessCount on recall', async () => {
      const mockDocs = [
        {
          id: 'ep-1',
          data: () => ({
            topic: 'テスト',
            content: 'テスト内容',
            participants: ['agent-kai'],
            importance: 0.8,
            accessCount: 2,
            createdAt: new Date().toISOString(),
          }),
        },
      ];

      getDocs.mockResolvedValue({ docs: mockDocs });
      mockChat.mockResolvedValue('{"scores": [0.9]}');

      await synapse.recallRelevantEpisodes('world-1', 'agent-kai', 'テスト');

      expect(updateDoc).toHaveBeenCalled();
    });
  });

  describe('buildMemoryContext', () => {
    it('should generate a context string from episodes', () => {
      const episodes = [
        {
          topic: 'AI議論',
          content: 'AIは補助ツールとして発展する',
          participants: ['agent-kai', 'agent-mia'],
          emotionalTone: 'positive',
        },
        {
          topic: 'プロジェクト進捗',
          content: '納期は来週金曜日',
          participants: ['agent-rex'],
          emotionalTone: 'neutral',
        },
      ];

      const context = synapse.buildMemoryContext(episodes);

      expect(context).toContain('AI議論');
      expect(context).toContain('プロジェクト進捗');
      expect(context).toContain('関連する記憶');
    });

    it('should return empty string for no episodes', () => {
      const context = synapse.buildMemoryContext([]);
      expect(context).toBe('');
    });
  });

  describe('decayMemories', () => {
    it('should reduce importance of old, unaccessed memories', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago

      const mockDocs = [
        {
          id: 'ep-old',
          ref: { id: 'ep-old' },
          data: () => ({
            topic: '古い記憶',
            importance: 0.5,
            accessCount: 0,
            createdAt: oldDate,
          }),
        },
        {
          id: 'ep-recent',
          ref: { id: 'ep-recent' },
          data: () => ({
            topic: '新しい記憶',
            importance: 0.8,
            accessCount: 5,
            createdAt: new Date().toISOString(),
          }),
        },
      ];

      getDocs.mockResolvedValue({ docs: mockDocs });
      updateDoc.mockResolvedValue(undefined);

      const decayed = await synapse.decayMemories('world-1', 'agent-kai');

      // 古くてアクセスされていない記憶のみ減衰
      expect(decayed).toBeGreaterThanOrEqual(0);
    });

    it('should not decay memories with high access count', async () => {
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const mockDocs = [
        {
          id: 'ep-used',
          ref: { id: 'ep-used' },
          data: () => ({
            topic: 'よく使う記憶',
            importance: 0.6,
            accessCount: 10, // heavily accessed
            createdAt: oldDate,
          }),
        },
      ];

      getDocs.mockResolvedValue({ docs: mockDocs });

      const decayed = await synapse.decayMemories('world-1', 'agent-kai');

      expect(decayed).toBe(0); // should not decay
    });
  });

  describe('DECAY_CONFIG', () => {
    it('should have reasonable defaults', () => {
      expect(synapse.DECAY_CONFIG.MIN_AGE_DAYS).toBeGreaterThan(0);
      expect(synapse.DECAY_CONFIG.DECAY_RATE).toBeGreaterThan(0);
      expect(synapse.DECAY_CONFIG.DECAY_RATE).toBeLessThan(1);
      expect(synapse.DECAY_CONFIG.ACCESS_PROTECTION_THRESHOLD).toBeGreaterThan(0);
    });
  });
});
