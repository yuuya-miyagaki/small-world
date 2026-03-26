import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-doc-id' })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(() => ({ docs: [], size: 0 })),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
}));

vi.mock('../../src/config/firebase.js', () => ({
  getFirebaseDb: vi.fn(() => ({})),
}));

// HF サービスモック
vi.mock('../../src/services/hfService.js', () => ({
  chat: vi.fn(),
  analyzeSentiment: vi.fn(() => [{ label: '4 stars', score: 0.7 }]),
  summarize: vi.fn(() => 'テストサマリー'),
}));

import { chat as mockChat } from '../../src/services/hfService.js';
import { getDocs, getDoc, setDoc } from 'firebase/firestore';

describe('MessageBus Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAgentResponse', () => {
    let handleAgentResponse;

    beforeEach(async () => {
      const module = await import('../../src/core/messageBus.js');
      handleAgentResponse = module.handleAgentResponse;

      // Mock getDoc to return an agent
      getDoc.mockResolvedValue({
        exists: () => true,
        id: 'agent-1',
        data: () => ({
          id: 'agent-1',
          name: 'TestAgent',
          role: 'リサーチャー',
          personality: {
            openness: 0.8,
            conscientiousness: 0.6,
            extraversion: 0.4,
            agreeableness: 0.5,
            neuroticism: 0.3,
          },
          mood: {
            energy: 0.7,
            stress: 0.3,
            valence: 0.6,
            dominantEmotion: 'neutral',
          },
          relationships: {},
          stats: { messagesGenerated: 0, memoriesFormed: 0, autonomousActions: 0 },
        }),
      });

      getDocs.mockResolvedValue({ docs: [], size: 0 });
      setDoc.mockResolvedValue(undefined);
    });

    it('should call HF chat API with correct message structure', async () => {
      mockChat.mockResolvedValueOnce('これは面白い研究テーマですね。');

      await handleAgentResponse('world-1', 'agent-1', 'channel-1', {
        content: 'こんにちは',
        senderId: 'user-1',
        senderName: 'TestUser',
        senderType: 'user',
      });

      expect(mockChat).toHaveBeenCalledTimes(1);
      const callArgs = mockChat.mock.calls[0];
      const messages = callArgs[0];

      // System prompt should be first
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('TestAgent');

      // User message should be last
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toContain('こんにちは');
    });

    it('should use fallback when HF API fails', async () => {
      mockChat.mockRejectedValueOnce(new Error('API Error'));

      const result = await handleAgentResponse('world-1', 'agent-1', 'channel-1', {
        content: 'テスト',
        senderId: 'user-1',
        senderName: 'TestUser',
        senderType: 'user',
      });

      // sendMessage should have been called with a fallback response
      expect(setDoc).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should pass temperature based on personality openness', async () => {
      mockChat.mockResolvedValueOnce('応答テスト');

      await handleAgentResponse('world-1', 'agent-1', 'channel-1', {
        content: 'テスト',
        senderId: 'user-1',
        senderName: 'TestUser',
        senderType: 'user',
      });

      const options = mockChat.mock.calls[0][1];
      // temperature = 0.6 + openness(0.8) * 0.3 = 0.84
      expect(options.temperature).toBeCloseTo(0.84, 1);
      expect(options.maxTokens).toBe(256);
    });

    it('should not throw when API fails and return a valid message', async () => {
      mockChat.mockRejectedValue(new Error('API Error'));

      const result = await handleAgentResponse('world-1', 'agent-1', 'channel-1', {
        content: 'テスト',
        senderId: 'user-1',
        senderName: 'TestUser',
        senderType: 'user',
      });

      // Should not throw, and should return a message object
      expect(result).toBeDefined();
      expect(result.id).toBe('mock-doc-id');
    });
  });
});
