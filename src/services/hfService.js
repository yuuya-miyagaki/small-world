/**
 * Hugging Face Inference API サービス
 * エージェントごとに異なるモデルを使い分けるためのアダプター
 */
import { getHfClient } from '../config/hf.js';

// 利用可能な HF モデルのプリセット
export const HF_MODELS = {
  QWEN_72B: 'Qwen/Qwen2.5-72B-Instruct',
  GEMMA_27B: 'google/gemma-2-27b-it',
  LLAMA_8B: 'meta-llama/Llama-3.1-8B-Instruct',
};

/**
 * HF モデルでチャット応答を生成する（OpenAI 互換形式）
 * @param {Array<{role: string, content: string}>} messages - メッセージ履歴
 * @param {Object} [options] - 追加オプション
 * @param {string} [options.model] - HF モデル ID
 * @param {number} [options.maxTokens] - 最大トークン数
 * @param {number} [options.temperature] - 温度パラメータ
 * @returns {Promise<string>} 応答テキスト
 */
export async function chat(messages, options = {}) {
  const client = getHfClient();
  const model = options.model || HF_MODELS.QWEN_72B;

  // HF chatCompletion は OpenAI 互換: system, user, assistant
  // Gemini の 'model' ロールを 'assistant' に変換
  const hfMessages = messages.map((m) => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.content,
  }));

  const response = await client.chatCompletion({
    model,
    messages: hfMessages,
    max_tokens: options.maxTokens || 512,
    temperature: options.temperature ?? 0.7,
  });

  return response.choices?.[0]?.message?.content || '';
}

/**
 * HF モデルでストリーミングチャット応答を生成する
 * @param {Array<{role: string, content: string}>} messages - メッセージ履歴
 * @param {Object} [options] - 追加オプション
 * @param {string} [options.model] - HF モデル ID
 * @param {number} [options.maxTokens] - 最大トークン数
 * @param {number} [options.temperature] - 温度パラメータ
 * @param {Function} [options.onChunk] - チャンク受信コールバック
 * @returns {Promise<string>} 完全な応答テキスト
 */
export async function chatStream(messages, options = {}) {
  const client = getHfClient();
  const model = options.model || HF_MODELS.QWEN_72B;

  const hfMessages = messages.map((m) => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.content,
  }));

  const stream = client.chatCompletionStream({
    model,
    messages: hfMessages,
    max_tokens: options.maxTokens || 512,
    temperature: options.temperature ?? 0.7,
  });

  let fullText = '';
  for await (const chunk of stream) {
    const chunkText = chunk.choices?.[0]?.delta?.content || '';
    fullText += chunkText;
    if (options.onChunk && chunkText) {
      options.onChunk(chunkText);
    }
  }

  return fullText;
}

/**
 * テキストの感情を分析する
 * @param {string} text - 分析対象テキスト
 * @param {string} [model] - 使用するモデル
 * @returns {Promise<Array<{label: string, score: number}>>} 感情スコアの配列
 */
export async function analyzeSentiment(text, model) {
  const client = getHfClient();

  const result = await client.textClassification({
    model: model || 'nlptown/bert-base-multilingual-uncased-sentiment',
    inputs: text,
  });

  return result;
}

/**
 * テキストを要約する
 * @param {string} text - 要約対象テキスト
 * @param {Object} [options] - オプション
 * @param {string} [options.model] - 使用するモデル
 * @param {number} [options.maxLength] - 最大文字数
 * @returns {Promise<string>} 要約テキスト
 */
export async function summarize(text, options = {}) {
  const client = getHfClient();
  const model = options.model || 'facebook/bart-large-cnn';

  const result = await client.summarization({
    model,
    inputs: text,
    parameters: {
      max_length: options.maxLength || 150,
    },
  });

  return result.summary_text;
}
