/**
 * Small World — 統一エラーハンドリング
 *
 * 全モジュール共通のエラー分類基盤。
 * UIレイヤーでは AppError.code に応じたトースト表示を行う。
 */

/**
 * 標準エラーコード
 */
export const ERROR_CODES = Object.freeze({
  API_LIMIT: 'API_LIMIT',
  NETWORK: 'NETWORK',
  AUTH: 'AUTH',
  FIRESTORE: 'FIRESTORE',
  VALIDATION: 'VALIDATION',
  UNKNOWN: 'UNKNOWN',
});

/**
 * アプリケーション固有のエラークラス
 */
export class AppError extends Error {
  /**
   * @param {string} code - ERROR_CODES のいずれか
   * @param {string} message - 人間が読めるエラーメッセージ
   * @param {Error} [cause] - 元のエラー（エラーチェーン用）
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 任意のエラーを AppError に分類する
 *
 * @param {Error} err - 分類対象のエラー
 * @returns {AppError} 分類済み AppError
 */
export function classifyError(err) {
  // Already classified
  if (err instanceof AppError) {
    return err;
  }

  // HTTP status-based classification
  if (err.status === 429) {
    return new AppError(ERROR_CODES.API_LIMIT, 'APIレート制限に達しました。しばらく待ってから再試行してください。', err);
  }
  if (err.status === 401 || err.status === 403) {
    return new AppError(ERROR_CODES.AUTH, '認証エラーが発生しました。再ログインしてください。', err);
  }

  // Network errors (TypeError: Failed to fetch)
  if (err instanceof TypeError && err.message.includes('fetch')) {
    return new AppError(ERROR_CODES.NETWORK, 'ネットワーク接続に失敗しました。インターネット接続を確認してください。', err);
  }

  // Firestore permission errors
  if (err.code === 'permission-denied') {
    return new AppError(ERROR_CODES.FIRESTORE, 'Firestore権限エラーが発生しました。', err);
  }

  // Unknown
  return new AppError(ERROR_CODES.UNKNOWN, err.message || '予期しないエラーが発生しました。', err);
}
