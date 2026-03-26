import { listWorlds, createWorld } from '../../services/worldService.js';
import { signOut } from '../../services/authService.js';
import { navigate } from '../router.js';

/**
 * ワールド一覧ページをレンダリングする
 * @param {Object} user - Firebase Auth ユーザー
 */
export async function renderWorlds(user) {
  const app = document.getElementById('app');

  // Loading
  app.innerHTML = `
    <div class="worlds-page">
      <div class="worlds-header">
        <h1>🌍 My Worlds</h1>
        <div class="header-right">
          <span class="worlds-user-info">${user.email}</span>
          <button class="btn btn-ghost" id="logoutBtn">ログアウト</button>
        </div>
      </div>
      <div class="loading-spinner"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    navigate('/');
  });

  // ワールド一覧取得
  let worlds = [];
  try {
    worlds = await listWorlds(user.uid);
  } catch (error) {
    console.error('[Worlds] Failed to load worlds:', error);
  }

  renderWorldsGrid(worlds, user);
}

function renderWorldsGrid(worlds, user) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="worlds-page">
      <div class="worlds-header">
        <h1>🌍 My Worlds</h1>
        <div class="worlds-header-right">
          <span class="worlds-user-info">${user.email}</span>
          <button class="btn btn-ghost" id="logoutBtn">ログアウト</button>
        </div>
      </div>
      <div class="worlds-grid">
        ${worlds.map((world, i) => `
          <div class="world-card glass" data-world-id="${world.id}" style="animation-delay: ${i * 0.1}s">
            <div class="world-card-header">
              <span class="world-card-icon">🌍</span>
              <span class="world-card-name">${world.name}</span>
            </div>
            <div class="world-card-meta">
              <span>🤖 ${world.agentCount || 3} agents</span>
            </div>
          </div>
        `).join('')}
        <div class="world-card world-card-create" id="createWorldBtn">
          <span class="plus-icon">+</span>
          <span>新しいワールドを作成</span>
        </div>
      </div>
    </div>
  `;

  // Event Bindings
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    navigate('/');
  });

  document.querySelectorAll('.world-card[data-world-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const worldId = card.dataset.worldId;
      navigate(`/dashboard/${worldId}`);
    });
  });

  document.getElementById('createWorldBtn')?.addEventListener('click', () => {
    showCreateWorldModal(user, worlds);
  });
}

function showCreateWorldModal(user, existingWorlds) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content glass">
      <h2>🌍 新しいワールドを作成</h2>
      <form id="createWorldForm">
        <div class="form-group">
          <label for="worldName">ワールド名</label>
          <input type="text" id="worldName" placeholder="My Small World" required />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancelCreate">キャンセル</button>
          <button type="submit" class="btn btn-primary">作成</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('cancelCreate').addEventListener('click', () => overlay.remove());

  document.getElementById('createWorldForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('worldName').value.trim();
    if (!name) return;

    const submitBtn = e.target.querySelector('[type="submit"]');
    submitBtn.textContent = '作成中...';
    submitBtn.disabled = true;

    try {
      const world = await createWorld(user.uid, name);
      overlay.remove();
      navigate(`/dashboard/${world.id}`);
    } catch (error) {
      console.error('[Worlds] Create failed:', error);
      submitBtn.textContent = '再試行';
      submitBtn.disabled = false;
    }
  });
}
