import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gemini クライアントをモック
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

vi.mock('../../src/config/gemini.js', () => {
  return {
    getGeminiClient: vi.fn(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
    initGeminiClient: vi.fn(),
  };
});

describe('AI Service (Gemini)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MODELS', () => {
    it('should use Gemini 2.0 Flash for chat', async () => {
      const { MODELS } = await import('../../src/services/aiService.js');
      expect(MODELS.CHAT).toBe('gemini-2.0-flash');
    });
  });

  describe('chat', () => {
    it('should call generateContent with correct parameters', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'テスト応答',
      });

      const { chat } = await import('../../src/services/aiService.js');
      const result = await chat([
        { role: 'user', content: 'こんにちは' },
      ]);

      expect(result).toBe('テスト応答');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-2.0-flash');
      expect(callArgs.contents).toEqual([
        { role: 'user', parts: [{ text: 'こんにちは' }] },
      ]);
    });

    it('should extract system messages as systemInstruction', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'システム応答',
      });

      const { chat } = await import('../../src/services/aiService.js');
      await chat([
        { role: 'system', content: 'あなたはAIアシスタントです' },
        { role: 'user', content: 'テスト' },
      ]);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.systemInstruction).toBe('あなたはAIアシスタントです');
      // contents にはシステムメッセージが含まれないこと
      expect(callArgs.contents).toEqual([
        { role: 'user', parts: [{ text: 'テスト' }] },
      ]);
    });

    it('should convert assistant role to model role', async () => {
      mockGenerateContent.mockResolvedValue({ text: '変換テスト' });

      const { chat } = await import('../../src/services/aiService.js');
      await chat([
        { role: 'user', content: 'ユーザー発言' },
        { role: 'assistant', content: 'AI発言' },
        { role: 'user', content: '次の発言' },
      ]);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.contents[0].role).toBe('user');
      expect(callArgs.contents[1].role).toBe('model');
      expect(callArgs.contents[2].role).toBe('user');
    });

    it('should accept custom options', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'カスタム応答' });

      const { chat } = await import('../../src/services/aiService.js');
      await chat(
        [{ role: 'user', content: 'テスト' }],
        { maxTokens: 128, temperature: 0.9 }
      );

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.maxOutputTokens).toBe(128);
      expect(callArgs.config.temperature).toBe(0.9);
    });

    it('should return empty string when no text', async () => {
      mockGenerateContent.mockResolvedValue({ text: null });

      const { chat } = await import('../../src/services/aiService.js');
      const result = await chat([{ role: 'user', content: 'テスト' }]);
      expect(result).toBe('');
    });
  });

  describe('analyzeSentiment', () => {
    it('should parse structured sentiment response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '[{"label": "positive", "score": 0.8}]',
      });

      const { analyzeSentiment } = await import('../../src/services/aiService.js');
      const result = await analyzeSentiment('とても良い日ですね');

      expect(result).toEqual([{ label: 'positive', score: 0.8 }]);
    });

    it('should return neutral on parse failure', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '感情分析に失敗しました',
      });

      const { analyzeSentiment } = await import('../../src/services/aiService.js');
      const result = await analyzeSentiment('テスト');

      expect(result).toEqual([{ label: 'neutral', score: 0.5 }]);
    });
  });

  describe('summarize', () => {
    it('should return Gemini generated summary', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '要約されたテキスト',
      });

      const { summarize } = await import('../../src/services/aiService.js');
      const result = await summarize('長いテキスト...');

      expect(result).toBe('要約されたテキスト');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});
