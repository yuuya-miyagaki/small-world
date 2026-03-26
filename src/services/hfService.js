import { getHfClient } from '../config/hf.js';

// デフォルトモデル定数
const MODELS = {
  CHAT: 'meta-llama/Llama-3.1-8B-Instruct',
  SENTIMENT: 'nlptown/bert-base-multilingual-uncased-sentiment',
  SUMMARIZATION: 'facebook/bart-large-cnn',
};

/**
 * チャット応答を生成する
 * @param {Array<{role: string, content: string}>} messages - メッセージ履歴
 * @param {Object} [options] - 追加オプション
 * @param {string} [options.model] - 使用するモデル
 * @param {number} [options.maxTokens] - 最大トークン数
 * @param {number} [options.temperature] - 温度パラメータ
 * @returns {Promise<string>} 応答テキスト
 */
export async function chat(messages, options = {}) {
  const client = getHfClient();
  const model = options.model || MODELS.CHAT;

  const response = await client.chatCompletion({
    model,
    messages,
    max_tokens: options.maxTokens || 512,
    temperature: options.temperature ?? 0.7,
  });

  return response.choices[0]?.message?.content || '';
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
    model: model || MODELS.SENTIMENT,
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
  const model = options.model || MODELS.SUMMARIZATION;

  const result = await client.summarization({
    model,
    inputs: text,
    parameters: {
      max_length: options.maxLength || 150,
    },
  });

  return result.summary_text;
}

export { MODELS };
