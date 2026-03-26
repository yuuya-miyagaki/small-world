import { HfInference } from '@huggingface/inference';

/** @type {HfInference|null} */
let client = null;

/**
 * HF Inference クライアントを初期化して返す
 * @param {string} [token] - HF APIトークン。省略時は環境変数から取得。
 * @returns {HfInference}
 */
export function initHfClient(token) {
  if (client) return client;

  const hfToken = token || import.meta.env.VITE_HF_TOKEN;
  if (!hfToken) {
    console.warn('[HF] Token not found. HF features will be unavailable.');
    return null;
  }

  client = new HfInference(hfToken);
  return client;
}

/**
 * 初期化済みの HF クライアントを取得
 * @returns {HfInference}
 */
export function getHfClient() {
  if (!client) throw new Error('HF client not initialized. Call initHfClient() first.');
  return client;
}
