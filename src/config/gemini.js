import { GoogleGenAI } from '@google/genai';

/** @type {GoogleGenAI|null} */
let client = null;

/**
 * Gemini クライアントを初期化して返す
 * @param {string} [apiKey] - Gemini APIキー。省略時は環境変数から取得。
 * @returns {GoogleGenAI}
 */
export function initGeminiClient(apiKey) {
  if (client) return client;

  const key = apiKey || import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) {
    console.warn('[Gemini] API key not found. AI features will be unavailable.');
    return null;
  }

  client = new GoogleGenAI({ apiKey: key });
  console.log('[Gemini] Client initialized successfully.');
  return client;
}

/**
 * 初期化済みの Gemini クライアントを取得
 * @returns {GoogleGenAI}
 */
export function getGeminiClient() {
  if (!client) throw new Error('Gemini client not initialized. Call initGeminiClient() first.');
  return client;
}
