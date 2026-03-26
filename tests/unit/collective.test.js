/**
 * Collective（議論エンジン）のユニットテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-session-id' })),
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

// AI サービスモック
vi.mock('../../src/services/aiService.js', () => ({
  chat: vi.fn(),
}));

// Personality モック
vi.mock('../../src/core/personality.js', () => ({
  generateSystemPrompt: vi.fn((agent) => `System prompt for ${agent.name}`),
}));

// Agent モック
vi.mock('../../src/core/agent.js', () => ({
  getAgent: vi.fn(),
  listAgents: vi.fn(),
}));

// Autonomy モック
vi.mock('../../src/core/autonomy.js', () => ({
  stopHeartbeatLoop: vi.fn(),
  startHeartbeatLoop: vi.fn(),
}));

import { chat as mockChat } from '../../src/services/aiService.js';
import { listAgents as mockListAgents, getAgent as mockGetAgent } from '../../src/core/agent.js';
import { stopHeartbeatLoop as mockStopHeartbeat } from '../../src/core/autonomy.js';

// テスト用エージェントデータ
const agents = [
  { id: 'agent-kai', name: 'Kai', role: 'リサーチャー', personality: { openness: 0.9, conscientiousness: 0.6, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.4 }, mood: { energy: 0.7, stress: 0.3, valence: 0.6, dominantEmotion: 'neutral' } },
  { id: 'agent-mia', name: 'Mia', role: 'ライター', personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.5, agreeableness: 0.9, neuroticism: 0.5 }, mood: { energy: 0.6, stress: 0.4, valence: 0.5, dominantEmotion: 'neutral' } },
  { id: 'agent-rex', name: 'Rex', role: 'マネージャー', personality: { openness: 0.5, conscientiousness: 0.7, extraversion: 0.9, agreeableness: 0.4, neuroticism: 0.2 }, mood: { energy: 0.8, stress: 0.2, valence: 0.7, dominantEmotion: 'neutral' } },
];

describe('Collective Module', () => {
  let startDiscussion, generateReport, DISCUSSION_CONFIG;

  beforeEach(async () => {
    vi.clearAllMocks();

    const collective = await import('../../src/core/collective.js');
    startDiscussion = collective.startDiscussion;
    generateReport = collective.generateReport;
    DISCUSSION_CONFIG = collective.DISCUSSION_CONFIG;

    mockListAgents.mockResolvedValue(agents);
    mockGetAgent.mockImplementation((_worldId, id) => {
      const found = agents.find((ag) => ag.id === id);
      return Promise.resolve(found || null);
    });
  });

  describe('DISCUSSION_CONFIG', () => {
    it('should have 2 rounds fixed', () => {
      expect(DISCUSSION_CONFIG.ROUNDS).toBe(2);
    });

    it('should have report generation enabled', () => {
      expect(DISCUSSION_CONFIG.GENERATE_REPORT).toBe(true);
    });
  });

  describe('startDiscussion', () => {
    it('should create a discussion session with theme and agents', async () => {
      mockChat.mockResolvedValue('テスト応答です。');

      const session = await startDiscussion('world-1', 'AIの未来について議論しましょう');

      expect(session).toBeDefined();
      expect(session.theme).toBe('AIの未来について議論しましょう');
      expect(session.rounds).toHaveLength(2);
      expect(session.status).toBe('completed');
    });

    it('should generate 3 contributions per round', async () => {
      mockChat.mockResolvedValue('各エージェントの意見です。');

      const session = await startDiscussion('world-1', 'テストテーマ');

      expect(session.rounds[0].contributions).toHaveLength(3);
      expect(session.rounds[1].contributions).toHaveLength(3);
    });

    it('should call chat() 6 times for 2 rounds × 3 agents', async () => {
      mockChat.mockResolvedValue('応答テキスト');

      await startDiscussion('world-1', 'テストテーマ');

      expect(mockChat).toHaveBeenCalledTimes(6);
    });

    it('should stop heartbeats during discussion', async () => {
      mockChat.mockResolvedValue('応答テキスト');

      await startDiscussion('world-1', 'テストテーマ');

      expect(mockStopHeartbeat).toHaveBeenCalledTimes(3);
    });

    it('should include all prior contributions in round 2 prompt', async () => {
      mockChat
        .mockResolvedValueOnce('Kaiの初期意見')
        .mockResolvedValueOnce('Miaの初期意見')
        .mockResolvedValueOnce('Rexの初期意見')
        .mockResolvedValueOnce('Kaiの反応')
        .mockResolvedValueOnce('Miaの反応')
        .mockResolvedValueOnce('Rexの反応');

      await startDiscussion('world-1', 'テスト');

      // ラウンド2のKaiへのプロンプト(4回目のchat呼び出し)には、ラウンド1の全意見が含まれる
      const round2KaiCall = mockChat.mock.calls[3];
      const messagesContent = round2KaiCall[0].map((m) => m.content).join(' ');
      expect(messagesContent).toContain('Kaiの初期意見');
      expect(messagesContent).toContain('Miaの初期意見');
      expect(messagesContent).toContain('Rexの初期意見');
    });

    it('should add debate override for high-agreeableness agents', async () => {
      mockChat.mockResolvedValue('応答');

      await startDiscussion('world-1', 'テスト');

      // Mia(agreeableness=0.9)のシステムプロンプト呼び出しを確認
      const miaCall = mockChat.mock.calls[1];
      const systemMsg = miaCall[0].find((m) => m.role === 'system');
      expect(systemMsg.content).toContain('批判的');
    });

    it('should handle API failure gracefully', async () => {
      mockChat
        .mockResolvedValueOnce('Kaiの意見')
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValue('他の応答');

      const session = await startDiscussion('world-1', 'テスト');

      expect(session.status).toBe('completed');
      const miaContrib = session.rounds[0].contributions.find((c) => c.agentName === 'Mia');
      expect(miaContrib.content).toBeTruthy();
    });
  });

  describe('generateReport', () => {
    it('should generate a markdown report from discussion', async () => {
      const mockSession = {
        theme: 'テストテーマ',
        rounds: [
          {
            roundNumber: 1,
            contributions: [
              { agentId: 'agent-kai', agentName: 'Kai', role: 'リサーチャー', content: 'データの観点から...', round: 1 },
              { agentId: 'agent-mia', agentName: 'Mia', role: 'ライター', content: '表現の観点から...', round: 1 },
              { agentId: 'agent-rex', agentName: 'Rex', role: 'マネージャー', content: '実行の観点から...', round: 1 },
            ],
          },
          {
            roundNumber: 2,
            contributions: [
              { agentId: 'agent-kai', agentName: 'Kai', role: 'リサーチャー', content: 'Rexの指摘も考慮すると...', round: 2 },
              { agentId: 'agent-mia', agentName: 'Mia', role: 'ライター', content: '私はちょっと違う見方で...', round: 2 },
              { agentId: 'agent-rex', agentName: 'Rex', role: 'マネージャー', content: 'まとめると...', round: 2 },
            ],
          },
        ],
      };

      mockChat.mockResolvedValue('# 議論レポート\n## 合意点\n- ポイント1\n## 相違点\n- ポイント2');

      const report = await generateReport(mockSession);

      expect(report).toContain('議論レポート');
      expect(mockChat).toHaveBeenCalledTimes(1);
      const chatOptions = mockChat.mock.calls[0][1];
      expect(chatOptions.maxTokens).toBe(1024);
    });
  });
});
