/**
 * Pipeline（タスクパイプライン）のユニットテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-pipeline-id' })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(() => ({ docs: [] })),
  query: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => new Date().toISOString()),
}));

vi.mock('../../src/config/firebase.js', () => ({
  getFirebaseDb: vi.fn(() => ({})),
}));

vi.mock('../../src/services/aiService.js', () => ({
  chat: vi.fn(),
}));

vi.mock('../../src/core/personality.js', () => ({
  generateSystemPrompt: vi.fn((agent) => `System prompt for ${agent.name}`),
}));

vi.mock('../../src/core/agent.js', () => ({
  getAgent: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock('../../src/core/autonomy.js', () => ({
  stopHeartbeatLoop: vi.fn(),
  startHeartbeatLoop: vi.fn(),
}));

import { chat as mockChat } from '../../src/services/aiService.js';
import { listAgents as mockListAgents } from '../../src/core/agent.js';
import { stopHeartbeatLoop as mockStopHeartbeat } from '../../src/core/autonomy.js';

const agents = [
  { id: 'agent-kai', name: 'Kai', role: 'リサーチャー', personality: { openness: 0.9, conscientiousness: 0.6, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.4 }, mood: { energy: 0.7, stress: 0.3, valence: 0.6, dominantEmotion: 'neutral' } },
  { id: 'agent-mia', name: 'Mia', role: 'ライター', personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.5, agreeableness: 0.9, neuroticism: 0.5 }, mood: { energy: 0.6, stress: 0.4, valence: 0.5, dominantEmotion: 'neutral' } },
  { id: 'agent-rex', name: 'Rex', role: 'マネージャー', personality: { openness: 0.5, conscientiousness: 0.7, extraversion: 0.9, agreeableness: 0.4, neuroticism: 0.2 }, mood: { energy: 0.8, stress: 0.2, valence: 0.7, dominantEmotion: 'neutral' } },
];

describe('Pipeline Module', () => {
  let runPipeline, PIPELINE_STAGES;

  beforeEach(async () => {
    vi.clearAllMocks();

    const pipeline = await import('../../src/core/pipeline.js');
    runPipeline = pipeline.runPipeline;
    PIPELINE_STAGES = pipeline.PIPELINE_STAGES;

    mockListAgents.mockResolvedValue(agents);
  });

  describe('PIPELINE_STAGES', () => {
    it('should have 3 stages in order: research, write, review', () => {
      expect(PIPELINE_STAGES).toHaveLength(3);
      expect(PIPELINE_STAGES[0].id).toBe('research');
      expect(PIPELINE_STAGES[1].id).toBe('write');
      expect(PIPELINE_STAGES[2].id).toBe('review');
    });

    it('should map each stage to the correct role', () => {
      expect(PIPELINE_STAGES[0].role).toBe('リサーチャー');
      expect(PIPELINE_STAGES[1].role).toBe('ライター');
      expect(PIPELINE_STAGES[2].role).toBe('マネージャー');
    });
  });

  describe('runPipeline', () => {
    it('should execute all 3 stages sequentially', async () => {
      mockChat
        .mockResolvedValueOnce('調査結果: AIの歴史は...')
        .mockResolvedValueOnce('# AIの未来\n\nAIは...')
        .mockResolvedValueOnce('レビュー完了。修正点...');

      const result = await runPipeline('world-1', 'AIの未来について記事を書いて');

      expect(result).toBeDefined();
      expect(result.stages).toHaveLength(3);
      expect(result.status).toBe('completed');
    });

    it('should call chat() exactly 3 times (one per stage)', async () => {
      mockChat.mockResolvedValue('出力テキスト');

      await runPipeline('world-1', 'テストタスク');

      expect(mockChat).toHaveBeenCalledTimes(3);
    });

    it('should pass previous stage output to next stage', async () => {
      mockChat
        .mockResolvedValueOnce('調査結果: 重要なデータ')
        .mockResolvedValueOnce('記事本文')
        .mockResolvedValueOnce('レビュー結果');

      await runPipeline('world-1', 'テスト');

      // Stage 2 (write) should receive stage 1 output
      const writeCall = mockChat.mock.calls[1];
      const writeContent = writeCall[0].map((m) => m.content).join(' ');
      expect(writeContent).toContain('調査結果: 重要なデータ');

      // Stage 3 (review) should receive stage 2 output
      const reviewCall = mockChat.mock.calls[2];
      const reviewContent = reviewCall[0].map((m) => m.content).join(' ');
      expect(reviewContent).toContain('記事本文');
    });

    it('should stop heartbeats during pipeline execution', async () => {
      mockChat.mockResolvedValue('出力');

      await runPipeline('world-1', 'テスト');

      expect(mockStopHeartbeat).toHaveBeenCalledTimes(3);
    });

    it('should assign Kai to research, Mia to write, Rex to review', async () => {
      mockChat.mockResolvedValue('出力');

      const result = await runPipeline('world-1', 'テスト');

      expect(result.stages[0].agentName).toBe('Kai');
      expect(result.stages[1].agentName).toBe('Mia');
      expect(result.stages[2].agentName).toBe('Rex');
    });

    it('should report progress via onProgress callback', async () => {
      mockChat.mockResolvedValue('出力');
      const progressCalls = [];

      await runPipeline('world-1', 'テスト', {
        onProgress: (info) => progressCalls.push(info),
      });

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0].stage).toBe('research');
      expect(progressCalls[1].stage).toBe('write');
      expect(progressCalls[2].stage).toBe('review');
    });

    it('should handle API failure gracefully with fallback', async () => {
      mockChat
        .mockResolvedValueOnce('調査結果')
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce('レビュー');

      const result = await runPipeline('world-1', 'テスト');

      expect(result.status).toBe('completed');
      expect(result.stages[1].content).toBeTruthy(); // fallback
      expect(result.stages[1].isFallback).toBe(true);
    });

    it('should include final deliverable from last stage', async () => {
      mockChat
        .mockResolvedValueOnce('調査')
        .mockResolvedValueOnce('記事本文')
        .mockResolvedValueOnce('最終版: 完成した記事です');

      const result = await runPipeline('world-1', 'テスト');

      expect(result.deliverable).toBe('最終版: 完成した記事です');
    });
  });
});
