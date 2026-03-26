import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-memory-id' })),
  setDoc: vi.fn(),
  getDocs: vi.fn(() => ({ docs: [], size: 0 })),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  where: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
}));

vi.mock('../../src/config/firebase.js', () => ({
  getFirebaseDb: vi.fn(() => ({})),
}));

vi.mock('../../src/services/hfService.js', () => ({
  summarize: vi.fn(() => 'テスト要約'),
}));

import { getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { summarize } from '../../src/services/hfService.js';

describe('Memory Module', () => {
  let memoryModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    memoryModule = await import('../../src/core/memory.js');
  });

  describe('addShortTermMemory', () => {
    it('should create a short-term memory document', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await memoryModule.addShortTermMemory('world-1', 'agent-1', {
        content: 'テストの記憶',
        type: 'conversation',
        source: 'user-1',
        channelId: 'channel-1',
      });

      expect(setDoc).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('テストの記憶');
      expect(result.type).toBe('conversation');
      expect(result.source).toBe('user-1');
      expect(result.id).toBe('mock-memory-id');
    });

    it('should default type to conversation', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await memoryModule.addShortTermMemory('world-1', 'agent-1', {
        content: 'デフォルトタイプテスト',
      });

      expect(result.type).toBe('conversation');
    });

    it('should default importance to 0.5', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await memoryModule.addShortTermMemory('world-1', 'agent-1', {
        content: 'デフォルト重要度テスト',
      });

      expect(result.importance).toBe(0.5);
    });
  });

  describe('checkConsolidationNeeded', () => {
    it('should return false when memory count is below threshold', async () => {
      getDocs.mockResolvedValue({ docs: [], size: 5 });

      const result = await memoryModule.checkConsolidationNeeded('world-1', 'agent-1');
      expect(result).toBe(false);
    });

    it('should return true when memory count reaches threshold', async () => {
      getDocs.mockResolvedValue({ docs: [], size: 10 });

      const result = await memoryModule.checkConsolidationNeeded('world-1', 'agent-1');
      expect(result).toBe(true);
    });

    it('should return true when memory count exceeds threshold', async () => {
      getDocs.mockResolvedValue({ docs: [], size: 15 });

      const result = await memoryModule.checkConsolidationNeeded('world-1', 'agent-1');
      expect(result).toBe(true);
    });
  });

  describe('CONSOLIDATION_THRESHOLD', () => {
    it('should be 10', () => {
      expect(memoryModule.CONSOLIDATION_THRESHOLD).toBe(10);
    });
  });

  describe('recallMemories', () => {
    it('should return empty array when no memories exist', async () => {
      getDocs.mockResolvedValue({ docs: [] });

      const result = await memoryModule.recallMemories('world-1', 'agent-1', 'テスト', 3);
      expect(result).toEqual([]);
    });

    it('should filter memories by keyword match', async () => {
      const mockDocs = [
        {
          id: 'mem-1',
          data: () => ({
            summary: 'テストの結果について議論した',
            keywords: ['テスト', '結果', '議論'],
            importance: 0.8,
          }),
        },
        {
          id: 'mem-2',
          data: () => ({
            summary: '天気の話をした',
            keywords: ['天気', '話'],
            importance: 0.5,
          }),
        },
      ];

      getDocs.mockResolvedValue({ docs: mockDocs });

      const result = await memoryModule.recallMemories('world-1', 'agent-1', 'テスト', 3);

      // Only 'テスト' related memory should be returned
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('mem-1');
    });
  });
});
