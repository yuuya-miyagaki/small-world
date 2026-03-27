import { describe, it, expect, vi, beforeEach } from 'vitest';

// HfInference を完全にモック（実際のAPIを呼ばない）
const mockChatCompletion = vi.fn();
const mockChatCompletionStream = vi.fn();
const mockTextClassification = vi.fn();
const mockSummarization = vi.fn();

vi.mock('@huggingface/inference', () => ({
  HfInference: vi.fn(() => ({
    chatCompletion: mockChatCompletion,
    chatCompletionStream: mockChatCompletionStream,
    textClassification: mockTextClassification,
    summarization: mockSummarization,
  })),
}));

// hf.js の getHfClient もモックして、上記の HfInference インスタンスを返す
vi.mock('../../src/config/hf.js', () => {
  return {
    getHfClient: vi.fn(() => ({
      chatCompletion: mockChatCompletion,
      chatCompletionStream: mockChatCompletionStream,
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

  describe('HF_MODELS', () => {
    it('should have Qwen 72B model', async () => {
      const { HF_MODELS } = await import('../../src/services/hfService.js');
      expect(HF_MODELS.QWEN_72B).toBe('Qwen/Qwen2.5-72B-Instruct');
    });

    it('should have Gemma 27B model', async () => {
      const { HF_MODELS } = await import('../../src/services/hfService.js');
      expect(HF_MODELS.GEMMA_27B).toBe('google/gemma-2-27b-it');
    });

    it('should have Llama 8B model', async () => {
      const { HF_MODELS } = await import('../../src/services/hfService.js');
      expect(HF_MODELS.LLAMA_8B).toBe('meta-llama/Llama-3.1-8B-Instruct');
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
        model: 'Qwen/Qwen2.5-72B-Instruct',
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

    it('should convert model role to assistant for HF compatibility', async () => {
      mockChatCompletion.mockResolvedValue({
        choices: [{ message: { content: '変換テスト' } }],
      });

      const { chat } = await import('../../src/services/hfService.js');
      await chat([
        { role: 'model', content: '前の返答' },
        { role: 'user', content: '次の質問' },
      ]);

      const callArgs = mockChatCompletion.mock.calls[0][0];
      expect(callArgs.messages[0].role).toBe('assistant');
      expect(callArgs.messages[1].role).toBe('user');
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
