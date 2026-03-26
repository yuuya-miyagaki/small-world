/**
 * Simple hash-based SPA router
 */

/** @type {Map<string, Function>} */
const routes = new Map();

/** @type {Function|null} */
let notFoundHandler = null;

/**
 * ルートを登録する
 * @param {string} path - ハッシュパス (例: '/', '/dashboard')
 * @param {Function} handler - (params) => void
 */
export function addRoute(path, handler) {
  routes.set(path, handler);
}

/**
 * 404 ハンドラーを登録する
 * @param {Function} handler
 */
export function setNotFound(handler) {
  notFoundHandler = handler;
}

/**
 * 指定パスに遷移する
 * @param {string} path
 */
export function navigate(path) {
  window.location.hash = path;
}

/**
 * 現在のハッシュパスを取得する
 * @returns {string}
 */
export function getCurrentPath() {
  return window.location.hash.slice(1) || '/';
}

/**
 * ルーターを初期化する
 */
export function initRouter() {
  const handleRoute = () => {
    const path = getCurrentPath();

    // パラメータ付きルートのマッチング (例: /dashboard/:worldId)
    for (const [pattern, handler] of routes) {
      const params = matchRoute(pattern, path);
      if (params !== null) {
        handler(params);
        return;
      }
    }

    // Not found
    if (notFoundHandler) {
      notFoundHandler();
    }
  };

  window.addEventListener('hashchange', handleRoute);
  handleRoute(); // 初回実行
}

/**
 * パターンとパスをマッチングする
 * @param {string} pattern - (例: /dashboard/:worldId)
 * @param {string} path - (例: /dashboard/abc123)
 * @returns {Object|null} パラメータオブジェクト or null
 */
function matchRoute(pattern, path) {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
