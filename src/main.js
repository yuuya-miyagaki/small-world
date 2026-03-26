import './styles/index.css';
import './styles/pages.css';
import './styles/dashboard.css';
import { initFirebase } from './config/firebase.js';
import { initHfClient } from './config/hf.js';
import { onAuthStateChanged } from './services/authService.js';
import { addRoute, initRouter, navigate, getCurrentPath } from './ui/router.js';
import { renderLogin } from './ui/pages/login.js';
import { renderWorlds } from './ui/pages/worlds.js';
import { renderDashboard } from './ui/pages/dashboard.js';

// Firebase & HF 初期化
initFirebase();
initHfClient();

// 認証状態
let currentUser = null;
let authReady = false;

// ルート定義
addRoute('/', () => {
  if (!authReady) {
    // 認証チェック中のローディング表示
    showLoading();
    return;
  }
  if (currentUser) {
    navigate('/worlds');
    return;
  }
  renderLogin();
});

addRoute('/worlds', () => {
  if (!authReady) {
    showLoading();
    return;
  }
  if (!currentUser) {
    navigate('/');
    return;
  }
  renderWorlds(currentUser);
});

addRoute('/dashboard/:worldId', (params) => {
  if (!authReady) {
    showLoading();
    return;
  }
  if (!currentUser) {
    navigate('/');
    return;
  }
  renderDashboard(params.worldId, currentUser);
});

// ルーター初期化（ルート定義後）
initRouter();

// 認証状態を監視 — 初回コールバックでルート再評価
try {
  onAuthStateChanged((user) => {
    currentUser = user;
    authReady = true;

    // 現在のルートを再評価
    const path = getCurrentPath();
    if (!user && path !== '/') {
      navigate('/');
    } else {
      // 同じハッシュでも再レンダリングさせるため手動トリガー
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });
} catch (error) {
  console.warn('[SmallWorld] Firebase Auth initialization failed:', error.message);
  authReady = true;
  renderLogin();
}

// フォールバック: 3秒以内に authReady にならなければログイン画面を表示
setTimeout(() => {
  if (!authReady) {
    console.warn('[SmallWorld] Auth timeout — showing login page');
    authReady = true;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}, 3000);

function showLoading() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="loading-spinner" style="height: 100vh;">
      <div class="spinner"></div>
    </div>
  `;
}
