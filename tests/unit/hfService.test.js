import { describe, it, expect, vi, beforeEach } from 'vitest';

// HfInference を完全にモック（実際のAPIを呼ばない）
const mockChatCompletion = vi.fn();
const mockTextClassification = vi.fn();
const mockSummarization = vi.fn();

vi.mock('@huggingface/inference', () => ({
  HfInference: vi.fn(() => ({
    chatCompletion: mockChatCompletion,
    textClassification: mockTextClassification,
    summarization: mockSummarization,
  })),
}));

// hf.js の getHfClient もモックして、上記の HfInference インスタンスを返す
vi.mock('../../src/config/hf.js', () => {
  return {
    getHfClient: vi.fn(() => ({
      chatCompletion: mockChatCompletion,
      textClassification: mockTextClassification,
      summarization: mockSummarization,
    })),
    initHfClient: vi.fn(),
  };
});

describe('HF Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MODELS', () => {
    it('should use Llama 3.1 for chat', async () => {
      const { MODELS } = await import('../../src/services/hfService.js');
      expect(MODELS.CHAT).toBe('meta-llama/Llama-3.1-8B-Instruct');
    });

    it('should use bert for sentiment analysis', async () => {
      const { MODELS } = await import('../../src/services/hfService.js');
      expect(MODELS.SENTIMENT).toBe('nlptown/bert-base-multilingual-uncased-sentiment');
    });

    it('should use bart for summarization', async () => {
      const { MODELS } = await import('../../src/services/hfService.js');
      expect(MODELS.SUMMARIZATION).toBe('facebook/bart-large-cnn');
    });
  });

  describe('chat', () => {
    it('should call chatCompletion with correct parameters', async () => {
      mockChatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'テスト応答' } }],
      });

      const { chat } = await import('../../src/services/hfService.js');
      const result = await chat([
        { role: 'user', content: 'こんにちは' },
      ]);

      expect(result).toBe('テスト応答');
      expect(mockChatCompletion).toHaveBeenCalledWith({
        model: 'meta-llama/Llama-3.1-8B-Instruct',
        messages: [{ role: 'user', content: 'こんにちは' }],
        max_tokens: 512,
        temperature: 0.7,
      });
    });

    it('should accept custom model and options', async () => {
      mockChatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'カスタム応答' } }],
      });

      const { chat } = await import('../../src/services/hfService.js');
      const result = await chat(
        [{ role: 'user', content: 'テスト' }],
        { model: 'custom/model', maxTokens: 128, temperature: 0.9 }
      );

      expect(result).toBe('カスタム応答');
      expect(mockChatCompletion).toHaveBeenCalledWith({
        model: 'custom/model',
        messages: [{ role: 'user', content: 'テスト' }],
        max_tokens: 128,
        temperature: 0.9,
      });
    });

    it('should return empty string when no choices', async () => {
      mockChatCompletion.mockResolvedValue({ choices: [] });

      const { chat } = await import('../../src/services/hfService.js');
      const result = await chat([{ role: 'user', content: 'テスト' }]);
      expect(result).toBe('');
    });
  });

  describe('analyzeSentiment', () => {
    it('should call textClassification with correct parameters', async () => {
      mockTextClassification.mockResolvedValue([
        { label: '4 stars', score: 0.7 },
      ]);

      const { analyzeSentiment } = await import('../../src/services/hfService.js');
      const result = await analyzeSentiment('とても良い日ですね');

      expect(result).toEqual([{ label: '4 stars', score: 0.7 }]);
      expect(mockTextClassification).toHaveBeenCalledWith({
        model: 'nlptown/bert-base-multilingual-uncased-sentiment',
        inputs: 'とても良い日ですね',
      });
    });
  });

  describe('summarize', () => {
    it('should call summarization with correct parameters', async () => {
      mockSummarization.mockResolvedValue({
        summary_text: '要約されたテキスト',
      });

      const { summarize } = await import('../../src/services/hfService.js');
      const result = await summarize('長いテキスト...');

      expect(result).toBe('要約されたテキスト');
      expect(mockSummarization).toHaveBeenCalledWith({
        model: 'facebook/bart-large-cnn',
        inputs: '長いテキスト...',
        parameters: { max_length: 150 },
      });
    });
  });
});
