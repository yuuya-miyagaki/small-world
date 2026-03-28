/**
 * TaskBoard — タスクボード UI コンポーネント (Phase 4)
 *
 * カンバンスタイルのタスク管理ボード。
 * 4カラム: 未着手 | 進行中 | レビュー | 完了
 *
 * 機能:
 * - タスクの作成・表示・詳細閲覧
 * - ドラッグ&ドロップによるステータス変更
 * - タスク実行（LLM呼び出し）
 * - リアルタイム更新（Firestore onSnapshot）
 */

import {
  createTask,
  listTasks,
  updateTaskStatus,
  assignTask,
  executeTask,
  deleteTask,
  subscribeToTasks,
  TASK_STATUSES,
  TASK_PRIORITIES,
  STATUS_LABELS,
  PRIORITY_CONFIG,
  VALID_TRANSITIONS,
} from '../../core/taskManager.js';
import { listAgents } from '../../core/agent.js';
import { listChannels } from '../../core/messageBus.js';

// --- 状態 ---
let boardState = {
  tasks: [],
  agents: [],
  channels: [],
  worldId: null,
  user: null,
  unsubscribe: null,
  selectedTask: null,
};

/**
 * タスクボードをレンダリングする
 * @param {HTMLElement} container - レンダリング先の要素
 * @param {Object} options - { worldId, user, agents, channels }
 */
export function renderTaskBoard(container, options) {
  boardState.worldId = options.worldId;
  boardState.user = options.user;
  boardState.agents = options.agents || [];
  boardState.channels = options.channels || [];

  container.innerHTML = renderBoard();
  bindBoardEvents(container);

  // リアルタイム購読開始
  if (boardState.unsubscribe) boardState.unsubscribe();
  boardState.unsubscribe = subscribeToTasks(boardState.worldId, (tasks) => {
    boardState.tasks = tasks;
    updateBoardUI(container);
  });
}

/**
 * タスクボードをクリーンアップする
 */
export function cleanupTaskBoard() {
  if (boardState.unsubscribe) {
    boardState.unsubscribe();
    boardState.unsubscribe = null;
  }
}

// --- レンダリング ---

function renderBoard() {
  const columns = [
    { status: 'pending', icon: '⏳', label: '未着手' },
    { status: 'in_progress', icon: '🔄', label: '進行中' },
    { status: 'review', icon: '👀', label: 'レビュー' },
    { status: 'completed', icon: '✅', label: '完了' },
  ];

  const tasksByStatus = {};
  for (const col of columns) {
    tasksByStatus[col.status] = boardState.tasks.filter((t) => t.status === col.status);
  }

  const stats = {
    total: boardState.tasks.filter((t) => t.status !== 'cancelled').length,
    completed: tasksByStatus.completed?.length || 0,
    inProgress: tasksByStatus.in_progress?.length || 0,
  };

  return `
    <div class="task-board">
      <div class="task-board-header">
        <div class="task-board-title">
          📋 タスクボード
        </div>
        <div class="task-board-stats">
          <div class="task-stat">
            <span>合計</span>
            <span class="task-stat-value">${stats.total}</span>
          </div>
          <div class="task-stat">
            <span>進行中</span>
            <span class="task-stat-value" style="color: var(--color-info)">${stats.inProgress}</span>
          </div>
          <div class="task-stat">
            <span>完了</span>
            <span class="task-stat-value" style="color: var(--color-success)">${stats.completed}</span>
          </div>
        </div>
      </div>

      <div class="kanban-container">
        ${columns.map((col) => renderColumn(col, tasksByStatus[col.status] || [])).join('')}
      </div>

      <div class="task-create-row">
        <button class="task-create-btn" id="taskCreateBtn">
          <span>➕</span>
          <span>新しいタスクを作成</span>
        </button>
      </div>
    </div>
  `;
}

function renderColumn(col, tasks) {
  return `
    <div class="kanban-column"
         data-status="${col.status}"
         ondragover="event.preventDefault()"
    >
      <div class="kanban-column-header">
        <div class="kanban-column-title">
          <span>${col.icon}</span>
          <span>${col.label}</span>
        </div>
        <span class="kanban-column-count">${tasks.length}</span>
      </div>
      <div class="kanban-column-body" data-drop-status="${col.status}">
        ${tasks.length > 0
          ? tasks.map((task) => renderTaskCard(task)).join('')
          : `<div class="kanban-column-empty">タスクなし</div>`
        }
      </div>
    </div>
  `;
}

function renderTaskCard(task) {
  const priorityCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const assignee = task.assigneeName || '未アサイン';
  const assigneeAgent = boardState.agents.find((a) => a.id === task.assigneeId);
  const canExecute = task.status === 'pending' || task.status === 'in_progress';
  const canComplete = task.status === 'review';

  return `
    <div class="task-card"
         data-task-id="${task.id}"
         draggable="true"
    >
      <div class="task-card-header">
        <div class="task-card-title">${escapeHtml(task.title)}</div>
        <span class="task-card-priority ${task.priority}">${priorityCfg.label}</span>
      </div>
      ${task.description ? `
        <div class="task-card-description">${escapeHtml(task.description)}</div>
      ` : ''}
      <div class="task-card-footer">
        <div class="task-card-assignee">
          ${assigneeAgent
            ? `<span class="task-card-assignee-avatar" style="background: ${assigneeAgent.color}20">${assigneeAgent.avatar}</span>`
            : '<span class="task-card-assignee-avatar" style="background: rgba(255,255,255,0.06)">👤</span>'
          }
          <span>${assignee}</span>
        </div>
        <div class="task-card-actions">
          ${canExecute ? `
            <button class="task-card-action-btn execute" data-action="execute" data-task-id="${task.id}" title="タスクを実行">
              ▶
            </button>
          ` : ''}
          ${canComplete ? `
            <button class="task-card-action-btn execute" data-action="complete" data-task-id="${task.id}" title="完了にする">
              ✓
            </button>
          ` : ''}
          <button class="task-card-action-btn" data-action="detail" data-task-id="${task.id}" title="詳細">
            ⋯
          </button>
        </div>
      </div>
    </div>
  `;
}

// --- イベントバインド ---

function bindBoardEvents(container) {
  // タスク作成
  container.querySelector('#taskCreateBtn')?.addEventListener('click', () => {
    showCreateTaskModal();
  });

  // カード上のアクションボタン + カードクリック
  container.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const taskId = actionBtn.dataset.taskId;

      if (action === 'execute') {
        await handleExecuteTask(taskId);
      } else if (action === 'complete') {
        await handleCompleteTask(taskId);
      } else if (action === 'detail') {
        showTaskDetail(taskId);
      }
      return;
    }

    // カードクリック → 詳細
    const card = e.target.closest('.task-card');
    if (card) {
      showTaskDetail(card.dataset.taskId);
    }
  });

  // ドラッグ&ドロップ
  setupDragAndDrop(container);
}

function setupDragAndDrop(container) {
  // Drag start
  container.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task-card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.taskId);
    e.dataTransfer.effectAllowed = 'move';
  });

  // Drag end
  container.addEventListener('dragend', (e) => {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
    container.querySelectorAll('.kanban-column').forEach((col) => col.classList.remove('drag-over'));
  });

  // Drag over columns
  container.addEventListener('dragover', (e) => {
    const dropZone = e.target.closest('[data-drop-status]');
    if (dropZone) {
      e.preventDefault();
      const column = dropZone.closest('.kanban-column');
      // 他のカラムをリセット
      container.querySelectorAll('.kanban-column').forEach((col) => col.classList.remove('drag-over'));
      if (column) column.classList.add('drag-over');
    }
  });

  // Drop
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    const dropZone = e.target.closest('[data-drop-status]');
    if (!dropZone) return;

    const taskId = e.dataTransfer.getData('text/plain');
    const newStatus = dropZone.dataset.dropStatus;

    container.querySelectorAll('.kanban-column').forEach((col) => col.classList.remove('drag-over'));

    if (!taskId || !newStatus) return;

    try {
      await updateTaskStatus(boardState.worldId, taskId, newStatus, boardState.user.uid);
    } catch (error) {
      showToastInBoard(error.message, 'error');
    }
  });
}

// --- UI更新 ---

function updateBoardUI(container) {
  const boardEl = container.querySelector('.task-board');
  if (!boardEl) return;

  // カラムだけ差分更新
  const columns = [
    { status: 'pending', icon: '⏳', label: '未着手' },
    { status: 'in_progress', icon: '🔄', label: '進行中' },
    { status: 'review', icon: '👀', label: 'レビュー' },
    { status: 'completed', icon: '✅', label: '完了' },
  ];

  const tasksByStatus = {};
  for (const col of columns) {
    tasksByStatus[col.status] = boardState.tasks.filter((t) => t.status === col.status);
  }

  // 各カラムのボディを更新
  for (const col of columns) {
    const bodyEl = boardEl.querySelector(`[data-drop-status="${col.status}"]`);
    const countEl = boardEl.querySelector(`[data-status="${col.status}"] .kanban-column-count`);
    const tasks = tasksByStatus[col.status] || [];

    if (bodyEl) {
      bodyEl.innerHTML = tasks.length > 0
        ? tasks.map((task) => renderTaskCard(task)).join('')
        : `<div class="kanban-column-empty">タスクなし</div>`;
    }
    if (countEl) {
      countEl.textContent = tasks.length;
    }
  }

  // 統計更新
  const stats = {
    total: boardState.tasks.filter((t) => t.status !== 'cancelled').length,
    completed: (tasksByStatus.completed || []).length,
    inProgress: (tasksByStatus.in_progress || []).length,
  };

  const statValues = boardEl.querySelectorAll('.task-stat-value');
  if (statValues[0]) statValues[0].textContent = stats.total;
  if (statValues[1]) statValues[1].textContent = stats.inProgress;
  if (statValues[2]) statValues[2].textContent = stats.completed;
}

// --- モーダル ---

function showCreateTaskModal() {
  const agentOptions = boardState.agents.map((a) =>
    `<option value="${a.id}">${a.avatar} ${a.name}（${a.role}）</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'task-modal';
  modal.id = 'taskCreateModal';
  modal.innerHTML = `
    <div class="task-modal-content">
      <h3 class="task-modal-title">📋 新しいタスクを作成</h3>

      <div class="task-form-group">
        <label class="task-form-label">タイトル *</label>
        <input type="text" class="task-form-input" id="taskTitleInput"
               placeholder="例: 市場調査レポートを書く" autofocus>
      </div>

      <div class="task-form-group">
        <label class="task-form-label">説明</label>
        <textarea class="task-form-textarea" id="taskDescInput"
                  placeholder="タスクの詳細を入力..."></textarea>
      </div>

      <div class="task-form-row">
        <div class="task-form-group">
          <label class="task-form-label">優先度</label>
          <select class="task-form-select" id="taskPriorityInput">
            <option value="low">🟢 低</option>
            <option value="medium" selected>🟡 中</option>
            <option value="high">🔴 高</option>
          </select>
        </div>
        <div class="task-form-group">
          <label class="task-form-label">アサイン先</label>
          <select class="task-form-select" id="taskAssigneeInput">
            <option value="">自動選択</option>
            ${agentOptions}
          </select>
        </div>
      </div>

      <div class="task-modal-actions">
        <button class="btn btn-ghost" id="taskCancelBtn">キャンセル</button>
        <button class="btn btn-primary" id="taskSubmitBtn">作成</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // フォーカス
  setTimeout(() => modal.querySelector('#taskTitleInput')?.focus(), 100);

  // イベント
  modal.querySelector('#taskCancelBtn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  const handleKeydown = (e) => {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', handleKeydown); }
  };
  document.addEventListener('keydown', handleKeydown);

  modal.querySelector('#taskSubmitBtn').addEventListener('click', async () => {
    const title = modal.querySelector('#taskTitleInput').value.trim();
    if (!title) {
      modal.querySelector('#taskTitleInput').style.borderColor = 'var(--color-danger)';
      return;
    }

    const description = modal.querySelector('#taskDescInput').value.trim();
    const priority = modal.querySelector('#taskPriorityInput').value;
    const assigneeId = modal.querySelector('#taskAssigneeInput').value;
    const assigneeAgent = boardState.agents.find((a) => a.id === assigneeId);

    const submitBtn = modal.querySelector('#taskSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '作成中...';

    try {
      await createTask(boardState.worldId, {
        title,
        description,
        priority,
        assigneeId: assigneeId || null,
        assigneeName: assigneeAgent?.name || null,
        creatorId: boardState.user.uid,
      });
      modal.remove();
      document.removeEventListener('keydown', handleKeydown);
      showToastInBoard('✅ タスクを作成しました', 'success');
    } catch (error) {
      console.error('[TaskBoard] Create failed:', error);
      showToastInBoard(`作成に失敗: ${error.message}`, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = '作成';
    }
  });

  // Enter で送信
  modal.querySelector('#taskTitleInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      modal.querySelector('#taskSubmitBtn').click();
    }
  });
}

// --- タスク詳細パネル ---

function showTaskDetail(taskId) {
  const task = boardState.tasks.find((t) => t.id === taskId);
  if (!task) return;

  // 既存の詳細パネルを閉じる
  document.querySelector('.task-detail-overlay')?.remove();

  const priorityCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const assigneeAgent = boardState.agents.find((a) => a.id === task.assigneeId);
  const agentOptions = boardState.agents.map((a) =>
    `<option value="${a.id}" ${a.id === task.assigneeId ? 'selected' : ''}>${a.avatar} ${a.name}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'task-detail-overlay';
  overlay.innerHTML = `
    <div class="task-detail-panel">
      <div class="task-detail-header">
        <h2 class="task-detail-title">${escapeHtml(task.title)}</h2>
        <button class="task-detail-close" id="taskDetailClose">✕</button>
      </div>

      <div class="task-detail-meta">
        <div class="task-detail-meta-item">
          <span class="task-detail-meta-label">ステータス</span>
          <span class="task-detail-meta-value">
            <span class="status-badge ${task.status}">${STATUS_LABELS[task.status]}</span>
          </span>
        </div>
        <div class="task-detail-meta-item">
          <span class="task-detail-meta-label">優先度</span>
          <span class="task-detail-meta-value">${priorityCfg.emoji} ${priorityCfg.label}</span>
        </div>
        <div class="task-detail-meta-item">
          <span class="task-detail-meta-label">アサイン</span>
          <span class="task-detail-meta-value">
            <select class="task-form-select" id="detailAssigneeSelect" style="padding: 4px 8px; font-size: 0.8rem;">
              <option value="">未アサイン</option>
              ${agentOptions}
            </select>
          </span>
        </div>
        <div class="task-detail-meta-item">
          <span class="task-detail-meta-label">作成日</span>
          <span class="task-detail-meta-value">${formatTimestamp(task.createdAt)}</span>
        </div>
      </div>

      ${task.description ? `
        <div class="task-detail-section">
          <div class="task-detail-section-title">📝 説明</div>
          <div class="task-detail-description">${escapeHtml(task.description)}</div>
        </div>
      ` : ''}

      <div class="task-detail-section">
        <div class="task-detail-section-title">🎯 アクション</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${renderActionButtons(task)}
        </div>
      </div>

      ${task.deliverables?.length > 0 ? `
        <div class="task-detail-section">
          <div class="task-detail-section-title">📦 成果物 (${task.deliverables.length})</div>
          ${task.deliverables.map((d) => `
            <div class="deliverable-item">
              <div class="deliverable-header">
                <span>${d.agentName || 'System'}</span>
                <span>${formatTimestamp(d.createdAt)}</span>
              </div>
              <div class="deliverable-content">${escapeHtml(d.content)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="task-detail-section">
        <div class="task-detail-section-title">📜 アクティビティ</div>
        <div class="activity-log">
          ${(task.activityLog || []).slice().reverse().map((log) => `
            <div class="activity-log-item">
              <div class="activity-log-dot"></div>
              <div class="activity-log-detail">${escapeHtml(log.detail)}</div>
              <div class="activity-log-time">${formatTimestamp(log.timestamp)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--color-border);">
        <button class="btn btn-danger" id="taskDeleteBtn" data-task-id="${task.id}">
          🗑️ タスクを削除
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close events
  overlay.querySelector('#taskDetailClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  });

  // Reassign
  overlay.querySelector('#detailAssigneeSelect')?.addEventListener('change', async (e) => {
    const newAssigneeId = e.target.value;
    if (newAssigneeId) {
      try {
        await assignTask(boardState.worldId, task.id, newAssigneeId);
        showToastInBoard('アサイン先を変更しました', 'success');
        // リアルタイム更新で詳細パネルも更新される（再表示で反映）
      } catch (err) {
        showToastInBoard(err.message, 'error');
      }
    }
  });

  // Execute
  overlay.querySelector('#detailExecuteBtn')?.addEventListener('click', async () => {
    overlay.remove();
    await handleExecuteTask(task.id);
  });

  // Status buttons
  overlay.querySelectorAll('[data-status-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.statusAction;
      try {
        await updateTaskStatus(boardState.worldId, task.id, newStatus, boardState.user.uid);
        overlay.remove();
        showToastInBoard(`ステータスを「${STATUS_LABELS[newStatus]}」に変更しました`, 'success');
      } catch (err) {
        showToastInBoard(err.message, 'error');
      }
    });
  });

  // Delete
  overlay.querySelector('#taskDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm(`タスク「${task.title}」を削除しますか？`)) return;
    try {
      await deleteTask(boardState.worldId, task.id);
      overlay.remove();
      showToastInBoard('タスクを削除しました', 'info');
    } catch (err) {
      showToastInBoard(err.message, 'error');
    }
  });
}

function renderActionButtons(task) {
  const buttons = [];
  const transitions = VALID_TRANSITIONS[task.status] || [];

  // 実行ボタン（pending/in_progress のみ）
  if (task.status === 'pending' || task.status === 'in_progress') {
    buttons.push(`
      <button class="btn btn-primary task-execute-btn" id="detailExecuteBtn">
        ▶ 実行
      </button>
    `);
  }

  // ステータス遷移ボタン
  for (const nextStatus of transitions) {
    if (nextStatus === 'cancelled') continue; // キャンセルは除外
    const label = STATUS_LABELS[nextStatus];
    const isComplete = nextStatus === 'completed';
    buttons.push(`
      <button class="btn ${isComplete ? 'btn-primary' : 'btn-ghost'}"
              data-status-action="${nextStatus}"
              style="${isComplete ? 'background: var(--color-success);' : ''}">
        ${isComplete ? '✅' : '→'} ${label}にする
      </button>
    `);
  }

  return buttons.join('');
}

// --- ハンドラ ---

async function handleExecuteTask(taskId) {
  const task = boardState.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const channelId = boardState.channels[0]?.id;

  showToastInBoard(`🔄 ${task.title} を実行中...`, 'info');

  try {
    const result = await executeTask(boardState.worldId, taskId, {
      channelId,
      onProgress: ({ agentName, stageName }) => {
        // 進捗は onSnapshot で自動反映される
        console.log(`[TaskBoard] ${agentName}: ${stageName}`);
      },
    });
    showToastInBoard(`✅ ${result.agentName} がタスクを完了しました`, 'success');
  } catch (error) {
    console.error('[TaskBoard] Execute failed:', error);
    showToastInBoard(`❌ 実行に失敗: ${error.message}`, 'error');
  }
}

async function handleCompleteTask(taskId) {
  try {
    await updateTaskStatus(boardState.worldId, taskId, 'completed', boardState.user.uid);
    showToastInBoard('✅ タスクを完了にしました', 'success');
  } catch (error) {
    showToastInBoard(error.message, 'error');
  }
}

// --- ユーティリティ ---

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  // Firestore Timestamp
  if (ts.toDate) return ts.toDate().toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  // ISO string
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return '';
}

function showToastInBoard(message, type) {
  type = type || 'info';
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
