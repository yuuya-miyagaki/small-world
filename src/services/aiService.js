import { getGeminiClient } from '../config/gemini.js';
import { chat as hfChat, chatStream as hfChatStream } from './hfService.js';

/**
 * エージェントの preferredModel 設定に基づいて適切な AI バックエンドにルーティング
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} options - { provider, model, temperature, maxTokens, onChunk }
 * @returns {Promise<string>}
 */
export async function chatWithModel(messages, options = {}) {
  const provider = options.provider || 'gemini';

  if (provider === 'huggingface') {
    if (options.onChunk) {
      return hfChatStream(messages, {
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        onChunk: options.onChunk,
      });
    }
    return hfChat(messages, {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  // デフォルト: Gemini
  if (options.onChunk) {
    return chatStream(messages, options);
  }
  return chat(messages, options);
}

// デフォルトモデル定数
const MODELS = {
  CHAT: 'gemini-2.5-flash',
};

// --- レートリミッター ---
// Gemini 2.5 Flash 無料枠は 10 RPM。安全マージンで 3秒間隔を確保
// テスト環境ではインターバル無効化
const isTestEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
const MIN_INTERVAL_MS = isTestEnv ? 0 : 1000;
let lastRequestTime = 0;
const requestQueue = [];
let isProcessingQueue = false;

/**
 * レートリミッター付きでAPIリクエストを実行
 * キューに入れて順番に処理し、429エラーを防止する
 * @param {Function} requestFn - 実行するリクエスト関数
 * @returns {Promise<*>}
 */
function rateLimitedRequest(requestFn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ requestFn, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const { requestFn, resolve, reject } = requestQueue.shift();

    // 最低間隔を保証
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await sleep(MIN_INTERVAL_MS - elapsed);
    }

    try {
      lastRequestTime = Date.now();
      const result = await executeWithRetry(requestFn, 2);
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }

  isProcessingQueue = false;
}

/**
 * リトライ付きリクエスト実行（429エラー時に指数バックオフ）
 */
async function executeWithRetry(requestFn, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      const is429 = error?.status === 429 ||
        error?.message?.includes('429') ||
        error?.message?.includes('Too Many Requests') ||
        error?.message?.includes('RESOURCE_EXHAUSTED');

      if (is429 && attempt < maxRetries) {
        const backoffMs = Math.min(5000 * (attempt + 1), 15000);
        console.warn(`[AI] Rate limited (429), retrying in ${backoffMs}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(backoffMs);
        continue;
      }
      throw error;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * チャット応答を生成する（Gemini API）
 * @param {Array<{role: string, content: string}>} messages - メッセージ履歴
 * @param {Object} [options] - 追加オプション
 * @param {string} [options.model] - 使用するモデル
 * @param {number} [options.maxTokens] - 最大トークン数
 * @param {number} [options.temperature] - 温度パラメータ
 * @returns {Promise<string>} 応答テキスト
 */
export async function chat(messages, options = {}) {
  const client = getGeminiClient();
  const model = options.model || MODELS.CHAT;

  // system メッセージを抽出してシステムインストラクションに変換
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Gemini API 用のコンテンツ形式に変換
  // Gemini は 'user' と 'model' のロールのみ対応
  const contents = nonSystemMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // 連続する同一ロールのメッセージをマージ（Gemini API の制約）
  const mergedContents = [];
  for (const msg of contents) {
    if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === msg.role) {
      const last = mergedContents[mergedContents.length - 1];
      last.parts.push({ text: msg.parts[0].text });
    } else {
      mergedContents.push({ ...msg });
    }
  }

  const requestPayload = {
    model,
    contents: mergedContents,
    config: {
      systemInstruction: systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n')
        : undefined,
      maxOutputTokens: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.7,
    },
  };

  const response = await rateLimitedRequest(() =>
    client.models.generateContent(requestPayload)
  );

  return response.text || '';
}

/**
 * ストリーミングでチャット応答を生成する（Gemini API）
 * チャンクごとにコールバックを呼び出し、体感速度を改善する。
 * @param {Array<{role: string, content: string}>} messages - メッセージ履歴
 * @param {Object} [options] - 追加オプション
 * @param {string} [options.model] - 使用するモデル
 * @param {number} [options.maxTokens] - 最大トークン数
 * @param {number} [options.temperature] - 温度パラメータ
 * @param {Function} [options.onChunk] - チャンク受信コールバック (text: string) => void
 * @returns {Promise<string>} 完全な応答テキスト
 */
export async function chatStream(messages, options = {}) {
  const client = getGeminiClient();
  const model = options.model || MODELS.CHAT;

  // system メッセージを抽出してシステムインストラクションに変換
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Gemini API 用のコンテンツ形式に変換
  const contents = nonSystemMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // 連続する同一ロールのメッセージをマージ
  const mergedContents = [];
  for (const msg of contents) {
    if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === msg.role) {
      const last = mergedContents[mergedContents.length - 1];
      last.parts.push({ text: msg.parts[0].text });
    } else {
      mergedContents.push({ ...msg });
    }
  }

  const requestPayload = {
    model,
    contents: mergedContents,
    config: {
      systemInstruction: systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n')
        : undefined,
      maxOutputTokens: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.7,
    },
  };

  // レートリミッター適用（初回リクエスト時のみ待機）
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const stream = await client.models.generateContentStream(requestPayload);

  let fullText = '';
  for await (const chunk of stream) {
    const chunkText = chunk.text || '';
    fullText += chunkText;
    if (options.onChunk && chunkText) {
      options.onChunk(chunkText);
    }
  }

  return fullText;
}

/**
 * テキストの感情を分析する（Gemini で代替実装）
 * @param {string} text - 分析対象テキスト
 * @returns {Promise<Array<{label: string, score: number}>>} 感情スコアの配列
 */
export async function analyzeSentiment(text) {
  const client = getGeminiClient();

  const requestPayload = {
    model: MODELS.CHAT,
    contents: text,
    config: {
      systemInstruction: `あなたは感情分析の専門家です。与えられたテキストの感情を分析し、以下のJSON形式のみで回答してください（他の文字列は含めないこと）:
[{"label": "感情ラベル", "score": 0.0-1.0}]
感情ラベルは: "very positive", "positive", "neutral", "negative", "very negative" のいずれか。`,
      temperature: 0.1,
      maxOutputTokens: 100,
    },
  };

  const response = await rateLimitedRequest(() =>
    client.models.generateContent(requestPayload)
  );

  try {
    // JSON 部分を抽出してパース
    const responseText = response.text || '';
    const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // パース失敗時はデフォルト値
  }

  return [{ label: 'neutral', score: 0.5 }];
}

/**
 * テキストを要約する（Gemini で実装）
 * @param {string} text - 要約対象テキスト
 * @param {Object} [options] - オプション
 * @param {number} [options.maxLength] - 最大文字数
 * @returns {Promise<string>} 要約テキスト
 */
export async function summarize(text, options = {}) {
  const client = getGeminiClient();
  const maxLength = options.maxLength || 150;

  const requestPayload = {
    model: MODELS.CHAT,
    contents: text,
    config: {
      systemInstruction: `以下のテキストを${maxLength}文字以内で要約してください。要約のみを出力してください。`,
      temperature: 0.3,
      maxOutputTokens: 256,
    },
  };

  const response = await rateLimitedRequest(() =>
    client.models.generateContent(requestPayload)
  );

  return response.text || '';
}

export { MODELS };
