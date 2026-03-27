import { listAgents, getAgent } from '../../core/agent.js';
import { listChannels, subscribeToChannel, sendMessage, handleAgentResponse } from '../../core/messageBus.js';
import { startHeartbeatLoop, stopAllHeartbeats } from '../../core/autonomy.js';
import { startDiscussion, generateReport } from '../../core/collective.js';
import { runPipeline } from '../../core/pipeline.js';
import { getWorld } from '../../services/worldService.js';
import { signOut } from '../../services/authService.js';
import { navigate } from '../router.js';
import { onSnapshot, collection } from 'firebase/firestore';
import { getFirebaseDb } from '../../config/firebase.js';

/** @type {Function|null} */
let unsubscribeMessages = null;

/** @type {Function|null} */
let unsubscribeAgents = null;

/**
 * ダッシュボードをレンダリングする
 * @param {string} worldId
 * @param {Object} user
 */
export async function renderDashboard(worldId, user) {
  const app = document.getElementById('app');

  // Cleanup previous subscriptions
  cleanup();

  // Loading
  app.innerHTML = `<div class="loading-spinner" style="height:100vh"><div class="spinner"></div></div>`;

  // データ取得
  let world, agents, channels;
  try {
    [world, agents, channels] = await Promise.all([
      getWorld(worldId),
      listAgents(worldId),
      listChannels(worldId),
    ]);
  } catch (error) {
    console.error('[Dashboard] Load failed:', error);
    app.innerHTML = '<div class="empty-state"><span class="empty-state-icon">❌</span><span class="empty-state-text">ワールドの読み込みに失敗しました</span></div>';
    return;
  }

  if (!world) {
    app.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🔍</span><span class="empty-state-text">ワールドが見つかりません</span></div>';
    return;
  }

  // State
  const state = {
    worldId,
    user,
    world,
    agents,
    channels,
    selectedAgent: agents[0] || null,
    selectedChannel: channels[0] || null,
    messages: [],
    isTyping: false,
  };

  renderDashboardUI(state);
  setupRealtimeListeners(state);
  setupHeartbeats(state);
}

function renderDashboardUI(state) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="dashboard">
      <!-- Header -->
      <header class="dashboard-header">
        <div class="header-left">
          <span class="header-logo">🌍 Small World</span>
          <span class="header-world-name">${state.world.name}</span>
        </div>
        <div class="header-right">
          <div class="header-status">
            <span class="status-dot"></span>
            <span>ハートビート稼働中</span>
          </div>
          <button class="btn btn-ghost" id="backToWorlds">ワールド一覧</button>
          <button class="btn btn-ghost" id="logoutBtn">ログアウト</button>
        </div>
      </header>

      <!-- Agent Sidebar -->
      <aside class="agent-sidebar">
        <div class="sidebar-section">
          <div class="sidebar-title">エージェント</div>
          <div id="agentList">
            ${renderAgentList(state)}
          </div>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-title">チャンネル</div>
          <div id="channelList">
            ${renderChannelList(state)}
          </div>
        </div>
      </aside>

      <!-- Chat Panel -->
      <main class="chat-panel">
        <div class="chat-header">
          <span class="chat-header-title"># ${state.selectedChannel?.name || 'general'}</span>
          <button class="btn btn-discussion" id="startDiscussionBtn" title="エージェント同士の議論を開始">
            🗣️ 議論
          </button>
          <button class="btn btn-pipeline" id="startPipelineBtn" title="タスクを分業で実行">
            ⚙️ タスク
          </button>
        </div>

        <!-- Pipeline Modal -->
        <div id="pipelineModal" class="discussion-modal" style="display: none;">
          <div class="discussion-modal-content">
            <h3>⚙️ タスクを入力</h3>
            <p class="discussion-desc">Kaiが調査 → Miaが執筆 → Rexがレビューして成果物を制作します。</p>
            <textarea id="pipelineTask" class="discussion-input" placeholder="例: AIの未来について記事を書いて" rows="3"></textarea>
            <div class="discussion-actions">
              <button class="btn btn-ghost" id="cancelPipeline">キャンセル</button>
              <button class="btn btn-primary" id="confirmPipeline">タスク開始</button>
            </div>
          </div>
        </div>

        <!-- Discussion Modal -->
        <div id="discussionModal" class="discussion-modal" style="display: none;">
          <div class="discussion-modal-content">
            <h3>🗣️ 議論テーマを入力</h3>
            <p class="discussion-desc">3人のエージェントが2ラウンドにわたり議論します。</p>
            <textarea id="discussionTheme" class="discussion-input" placeholder="例: AIが人間の仕事を奪うのか、新しい仕事を作るのか" rows="3"></textarea>
            <div class="discussion-actions">
              <button class="btn btn-ghost" id="cancelDiscussion">キャンセル</button>
              <button class="btn btn-primary" id="confirmDiscussion">議論を開始</button>
            </div>
          </div>
        </div>

        <!-- Discussion Progress -->
        <div id="discussionProgress" class="discussion-progress" style="display: none;">
          <div class="discussion-progress-bar">
            <div class="discussion-progress-fill" id="progressFill"></div>
          </div>
          <span id="progressText" class="discussion-progress-text">準備中...</span>
        </div>
        <div class="chat-messages" id="chatMessages">
          <div class="empty-state">
            <span class="empty-state-icon">💬</span>
            <span class="empty-state-text">メッセージがまだありません。<br>エージェントに話しかけてみましょう！</span>
          </div>
        </div>
        <div id="typingIndicator" class="chat-typing" style="display: none;">
          <div class="typing-dots"><span></span><span></span><span></span></div>
          <span id="typingName">考え中...</span>
        </div>
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <textarea class="chat-input" id="chatInput" placeholder="メッセージを入力..." rows="1"></textarea>
            <button class="chat-send-btn" id="sendBtn">▶</button>
          </div>
        </div>
      </main>

      <!-- Detail Panel -->
      <aside class="detail-panel" id="detailPanel">
        ${state.selectedAgent ? renderAgentDetail(state.selectedAgent, state.agents) : renderEmptyDetail()}
      </aside>
    </div>
  `;

  // Event Bindings
  bindDashboardEvents(state);
}

function renderAgentList(state) {
  return state.agents.map((agent) => `
    <div class="agent-item ${state.selectedAgent?.id === agent.id ? 'active' : ''}" data-agent-id="${agent.id}">
      <div class="agent-avatar" style="background: ${agent.color}20">
        <span>${agent.avatar}</span>
        <span class="agent-status-badge ${agent.status || 'idle'}"></span>
      </div>
      <div class="agent-info">
        <div class="agent-name">${agent.name}</div>
        <div class="agent-role">${agent.role}</div>
      </div>
      <div class="mood-bars">
        <div class="mood-bar mood-bar-energy">
          <div class="mood-bar-fill" style="width: ${(agent.mood?.energy ?? 0.7) * 100}%"></div>
        </div>
        <div class="mood-bar mood-bar-stress">
          <div class="mood-bar-fill" style="width: ${(agent.mood?.stress ?? 0.3) * 100}%"></div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderChannelList(state) {
  return state.channels.map((ch) => `
    <div class="channel-item ${state.selectedChannel?.id === ch.id ? 'active' : ''}" data-channel-id="${ch.id}">
      <span class="channel-hash">#</span>
      <span>${ch.name}</span>
    </div>
  `).join('');
}

function renderAgentDetail(agent, allAgents) {
  const p = agent.personality || {};
  const m = agent.mood || {};

  return `
    <div class="detail-header">
      <div class="detail-avatar" style="background: ${agent.color}20; font-size: 2rem;">
        ${agent.avatar}
      </div>
      <div class="detail-name">${agent.name}</div>
      <div class="detail-role">${agent.role}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">性格 (Big Five)</div>
      <div class="personality-bars">
        ${renderPersonalityBar('開放性', p.openness)}
        ${renderPersonalityBar('誠実性', p.conscientiousness)}
        ${renderPersonalityBar('外向性', p.extraversion)}
        ${renderPersonalityBar('協調性', p.agreeableness)}
        ${renderPersonalityBar('神経症', p.neuroticism)}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">気分</div>
      <div class="mood-detail-grid">
        <div class="mood-detail-item">
          <div class="mood-detail-label">エネルギー</div>
          <div class="mood-detail-value" style="color: var(--color-success)">${Math.round((m.energy ?? 0.7) * 100)}%</div>
        </div>
        <div class="mood-detail-item">
          <div class="mood-detail-label">ストレス</div>
          <div class="mood-detail-value" style="color: var(--color-warning)">${Math.round((m.stress ?? 0.3) * 100)}%</div>
        </div>
        <div class="mood-detail-item">
          <div class="mood-detail-label">感情価</div>
          <div class="mood-detail-value" style="color: var(--color-info)">${Math.round((m.valence ?? 0.6) * 100)}%</div>
        </div>
        <div class="mood-detail-item">
          <div class="mood-detail-label">感情</div>
          <div class="mood-detail-value">${m.dominantEmotion || 'neutral'}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">関係性</div>
      ${renderRelationships(agent, allAgents)}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">統計</div>
      <div style="font-size: var(--text-xs); color: var(--color-text-secondary);">
        <div>💬 メッセージ: ${agent.stats?.messagesGenerated || 0}</div>
        <div>🧠 記憶: ${agent.stats?.memoriesFormed || 0}</div>
        <div>🤖 自律行動: ${agent.stats?.autonomousActions || 0}</div>
      </div>
    </div>
  `;
}

function renderPersonalityBar(label, value) {
  const v = (value ?? 0.5) * 100;
  return `
    <div class="personality-bar-row">
      <span class="personality-label">${label}</span>
      <div class="personality-bar">
        <div class="personality-bar-fill" style="width: ${v}%"></div>
      </div>
    </div>
  `;
}

function renderRelationships(agent, allAgents) {
  const rels = agent.relationships || {};
  if (Object.keys(rels).length === 0) {
    return '<div style="font-size: var(--text-xs); color: var(--color-text-muted);">まだ交流がありません</div>';
  }

  // エージェント名のマップを作成
  const agentMap = {};
  if (allAgents) {
    for (const a of allAgents) {
      agentMap[a.id] = a;
    }
  }

  const labelColors = {
    '親密': 'var(--color-success)',
    '友好的': 'var(--color-info)',
    '中立': 'var(--color-text-secondary)',
    '冷淡': 'var(--color-warning)',
    '敵対的': 'var(--color-error, #ef4444)',
  };

  return Object.entries(rels).map(([id, rel]) => {
    const other = agentMap[id];
    const name = other?.name || id.slice(0, 8);
    const avatar = other?.avatar || '🤖';
    const score = rel.score ?? 0.5;
    const label = getRelLabel(score);
    const labelColor = labelColors[label] || 'var(--color-text-secondary)';

    return `
      <div class="relationship-item">
        <span class="relationship-avatar">${avatar}</span>
        <span class="relationship-label">${name}</span>
        <div class="relationship-score">
          <div class="relationship-score-fill" style="width: ${score * 100}%"></div>
        </div>
        <span class="relationship-badge" style="color: ${labelColor}">${label}</span>
      </div>
    `;
  }).join('');
}

/** スコアから関係性ラベルを返す */
function getRelLabel(score) {
  if (score <= 0.2) return '敵対的';
  if (score <= 0.4) return '冷淡';
  if (score <= 0.6) return '中立';
  if (score <= 0.8) return '友好的';
  return '親密';
}

function renderEmptyDetail() {
  return `
    <div class="empty-state">
      <span class="empty-state-icon">👤</span>
      <span class="empty-state-text">エージェントを選択してください</span>
    </div>
  `;
}

function renderMessages(messages) {
  if (messages.length === 0) {
    return `
      <div class="empty-state">
        <span class="empty-state-icon">💬</span>
        <span class="empty-state-text">メッセージがまだありません。<br>エージェントに話しかけてみましょう！</span>
      </div>
    `;
  }

  return messages.map((msg) => {
    const time = msg.createdAt?.toDate
      ? msg.createdAt.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      : '';

    const sentimentClass = msg.metadata?.sentiment > 0.6 ? 'sentiment-positive'
      : msg.metadata?.sentiment < 0.4 ? 'sentiment-negative'
      : 'sentiment-neutral';

    const isAgent = msg.senderType === 'agent';
    const avatarColor = isAgent ? '#6366f120' : '#3b82f620';
    const avatar = isAgent ? (msg.avatar || '🤖') : '👤';

    return `
      <div class="chat-message">
        <div class="chat-message-avatar" style="background: ${avatarColor}">
          ${avatar}
        </div>
        <div class="chat-message-body">
          <div class="chat-message-header">
            <span class="chat-message-name" style="color: ${isAgent ? 'var(--color-text-accent)' : 'var(--color-info)'}">${msg.senderName}</span>
            <span class="chat-message-time">${time}</span>
            ${msg.metadata?.emotion ? `<span class="sentiment-badge ${sentimentClass}">${msg.metadata.emotion}</span>` : ''}
          </div>
          <div class="chat-message-content">${escapeHtml(msg.content)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function bindDashboardEvents(state) {
  // Back to worlds
  document.getElementById('backToWorlds')?.addEventListener('click', () => {
    cleanup();
    navigate('/worlds');
  });

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    cleanup();
    await signOut();
    navigate('/');
  });

  // Agent selection
  document.querySelectorAll('.agent-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const agentId = item.dataset.agentId;
      state.selectedAgent = state.agents.find((a) => a.id === agentId) || null;

      // Update UI
      document.querySelectorAll('.agent-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');

      const detailPanel = document.getElementById('detailPanel');
      if (detailPanel && state.selectedAgent) {
        detailPanel.innerHTML = renderAgentDetail(state.selectedAgent, state.agents);
      }
    });
  });

  // Channel selection
  document.querySelectorAll('.channel-item').forEach((item) => {
    item.addEventListener('click', () => {
      const channelId = item.dataset.channelId;
      state.selectedChannel = state.channels.find((c) => c.id === channelId) || null;

      document.querySelectorAll('.channel-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');

      // Re-subscribe to new channel
      if (unsubscribeMessages) unsubscribeMessages();
      if (state.selectedChannel) {
        subscribeToMessages(state);
      }
    });
  });

  // Send message
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');

  const handleSend = async () => {
    const content = chatInput.value.trim();
    if (!content || !state.selectedChannel || state.isTyping) return;

    state.isTyping = true;
    chatInput.value = '';
    chatInput.style.height = 'auto';

    try {
      // Send user message
      await sendMessage(state.worldId, state.selectedChannel.id, {
        content,
        senderId: state.user.uid,
        senderName: state.user.email?.split('@')[0] || 'User',
        senderType: 'user',
      });

      // Show typing indicator
      showTyping(state.agents.map((a) => a.name).join(', '));

      // Get agent responses — 会話チェーン方式
      // Agent 1 → ユーザーに応答
      // Agent 2 → Agent 1 の応答を踏まえて発言
      // Agent 3 → Agent 2 の応答を踏まえて発言
      let lastMessage = {
        content,
        senderId: state.user.uid,
        senderName: state.user.email?.split('@')[0] || 'User',
        senderType: 'user',
      };

      for (const agent of state.agents) {
        try {
          const response = await handleAgentResponse(
            state.worldId,
            agent.id,
            state.selectedChannel.id,
            lastMessage
          );
          // 次のエージェントは、このエージェントの応答に対して返答する
          lastMessage = {
            content: response.content,
            senderId: agent.id,
            senderName: agent.name,
            senderType: 'agent',
          };
        } catch (error) {
          console.error(`[Chat] Agent ${agent.name} response failed:`, error);
        }
      }
    } finally {
      state.isTyping = false;
      hideTyping();
    }
  };

  sendBtn?.addEventListener('click', handleSend);

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  // Discussion engine
  bindDiscussionEvents(state);

  // Pipeline engine
  bindPipelineEvents(state);
}

function setupRealtimeListeners(state) {
  // Subscribe to messages
  if (state.selectedChannel) {
    subscribeToMessages(state);
  }

  // Subscribe to agent updates
  const db = getFirebaseDb();
  unsubscribeAgents = onSnapshot(
    collection(db, `worlds/${state.worldId}/agents`),
    (snapshot) => {
      state.agents = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Update agent list UI
      const agentListEl = document.getElementById('agentList');
      if (agentListEl) {
        agentListEl.innerHTML = renderAgentList(state);

        // Re-bind click events
        document.querySelectorAll('.agent-item').forEach((item) => {
          item.addEventListener('click', async () => {
            const agentId = item.dataset.agentId;
            state.selectedAgent = state.agents.find((a) => a.id === agentId) || null;
            document.querySelectorAll('.agent-item').forEach((el) => el.classList.remove('active'));
            item.classList.add('active');
            const detailPanel = document.getElementById('detailPanel');
            if (detailPanel && state.selectedAgent) {
              detailPanel.innerHTML = renderAgentDetail(state.selectedAgent, state.agents);
            }
          });
        });
      }

      // Update detail panel if selected agent changed
      if (state.selectedAgent) {
        const updated = state.agents.find((a) => a.id === state.selectedAgent.id);
        if (updated) {
          state.selectedAgent = updated;
          const detailPanel = document.getElementById('detailPanel');
          if (detailPanel) {
            detailPanel.innerHTML = renderAgentDetail(updated, state.agents);
          }
        }
      }
    }
  );
}

function subscribeToMessages(state) {
  unsubscribeMessages = subscribeToChannel(state.worldId, state.selectedChannel.id, (messages) => {
    state.messages = messages;
    const chatEl = document.getElementById('chatMessages');
    if (chatEl) {
      chatEl.innerHTML = renderMessages(messages);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  });
}

function setupHeartbeats(state) {
  const interval = state.world.settings?.heartbeatInterval || 30000;
  for (const agent of state.agents) {
    startHeartbeatLoop(state.worldId, agent.id, interval);
  }
}

function showTyping(name) {
  const el = document.getElementById('typingIndicator');
  const nameEl = document.getElementById('typingName');
  if (el) el.style.display = 'flex';
  if (nameEl) nameEl.textContent = `${name} が考え中...`;
}

function hideTyping() {
  const el = document.getElementById('typingIndicator');
  if (el) el.style.display = 'none';
}

function cleanup() {
  stopAllHeartbeats();
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  if (unsubscribeAgents) { unsubscribeAgents(); unsubscribeAgents = null; }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================
// 議論エンジン UI
// ==========================================

function bindDiscussionEvents(state) {
  const startBtn = document.getElementById('startDiscussionBtn');
  const modal = document.getElementById('discussionModal');
  const cancelBtn = document.getElementById('cancelDiscussion');
  const confirmBtn = document.getElementById('confirmDiscussion');
  const themeInput = document.getElementById('discussionTheme');

  startBtn?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
    themeInput?.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
    if (themeInput) themeInput.value = '';
  });

  confirmBtn?.addEventListener('click', async () => {
    const theme = themeInput?.value.trim();
    if (!theme) return;

    if (modal) modal.style.display = 'none';
    await runDiscussion(state, theme);
  });

  themeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmBtn?.click();
    }
  });
}

async function runDiscussion(state, theme) {
  const progressEl = document.getElementById('discussionProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const startBtn = document.getElementById('startDiscussionBtn');
  const chatMessages = document.getElementById('chatMessages');

  // UIを議論モードに
  if (progressEl) progressEl.style.display = 'flex';
  if (startBtn) startBtn.disabled = true;

  try {
    // 議論実行
    const session = await startDiscussion(state.worldId, theme, {
      onProgress: ({ step, total, agentName, round }) => {
        const pct = Math.round((step / total) * 100);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `ラウンド${round}: ${agentName} が発言中... (${step}/${total})`;
      },
    });

    // レポート生成
    if (progressText) progressText.textContent = 'レポートを生成中...';
    if (progressFill) progressFill.style.width = '90%';

    const report = await generateReport(session);

    if (progressFill) progressFill.style.width = '100%';

    // 議論結果をチャットに表示
    if (chatMessages) {
      const discussionHtml = renderDiscussionResult(session, report);
      chatMessages.innerHTML += discussionHtml;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Firestoreにもメッセージとして保存（チャット履歴に残す）
    await sendMessage(state.worldId, state.selectedChannel.id, {
      content: `🗣️ 議論テーマ: ${theme}`,
      senderId: state.user.uid,
      senderName: 'System',
      senderType: 'system',
    });

  } catch (error) {
    console.error('[Discussion] Failed:', error);
    if (progressText) progressText.textContent = `❌ 議論に失敗しました: ${error.message}`;
  } finally {
    // UI復帰
    setTimeout(() => {
      if (progressEl) progressEl.style.display = 'none';
      if (startBtn) startBtn.disabled = false;
      // ハートビート再開
      setupHeartbeats(state);
    }, 2000);
  }
}

function renderDiscussionResult(session, report) {
  const roundsHtml = session.rounds.map((round) => {
    const contribs = round.contributions.map((c) => `
      <div class="discussion-contribution">
        <div class="discussion-speaker">
          <strong>${c.agentName}</strong>
          <span class="discussion-role">${c.role}</span>
        </div>
        <div class="discussion-text">${escapeHtml(c.content)}</div>
      </div>
    `).join('');

    return `
      <div class="discussion-round">
        <div class="discussion-round-header">ラウンド ${round.roundNumber}</div>
        ${contribs}
      </div>
    `;
  }).join('');

  return `
    <div class="discussion-result">
      <div class="discussion-result-header">
        <span class="discussion-result-icon">🗣️</span>
        <span>議論: ${escapeHtml(session.theme)}</span>
      </div>
      ${roundsHtml}
      <div class="discussion-report">
        <div class="discussion-report-header">📋 レポート</div>
        <div class="discussion-report-content">${escapeHtml(report).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  `;
}

// ==========================================
// タスクパイプライン UI
// ==========================================

function bindPipelineEvents(state) {
  const startBtn = document.getElementById('startPipelineBtn');
  const modal = document.getElementById('pipelineModal');
  const cancelBtn = document.getElementById('cancelPipeline');
  const confirmBtn = document.getElementById('confirmPipeline');
  const taskInput = document.getElementById('pipelineTask');

  startBtn?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
    taskInput?.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
    if (taskInput) taskInput.value = '';
  });

  confirmBtn?.addEventListener('click', async () => {
    const task = taskInput?.value.trim();
    if (!task) return;

    if (modal) modal.style.display = 'none';
    await executePipeline(state, task);
  });

  taskInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmBtn?.click();
    }
  });
}

async function executePipeline(state, task) {
  const progressEl = document.getElementById('discussionProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const startBtn = document.getElementById('startPipelineBtn');
  const chatMessages = document.getElementById('chatMessages');

  if (progressEl) progressEl.style.display = 'flex';
  if (startBtn) startBtn.disabled = true;

  try {
    const result = await runPipeline(state.worldId, task, {
      onProgress: ({ stageName, agentName, step, total }) => {
        const pct = Math.round((step / total) * 100);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `${agentName} が${stageName}中... (${step}/${total})`;
      },
    });

    if (progressFill) progressFill.style.width = '100%';

    if (chatMessages) {
      chatMessages.innerHTML += renderPipelineResult(result);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    await sendMessage(state.worldId, state.selectedChannel.id, {
      content: `⚙️ タスク完了: ${task}`,
      senderId: state.user.uid,
      senderName: 'System',
      senderType: 'system',
    });

  } catch (error) {
    console.error('[Pipeline] Failed:', error);
    if (progressText) progressText.textContent = `❌ タスクに失敗: ${error.message}`;
  } finally {
    setTimeout(() => {
      if (progressEl) progressEl.style.display = 'none';
      if (startBtn) startBtn.disabled = false;
      setupHeartbeats(state);
    }, 2000);
  }
}

function renderPipelineResult(result) {
  const stagesHtml = result.stages.map((s) => `
    <div class="pipeline-stage">
      <div class="pipeline-stage-header">
        <span class="pipeline-stage-emoji">${s.emoji}</span>
        <strong>${s.agentName}</strong>
        <span class="discussion-role">${s.stageName}</span>
        ${s.isFallback ? '<span class="pipeline-fallback">⚠ フォールバック</span>' : ''}
      </div>
      <div class="pipeline-stage-content">${escapeHtml(s.content).replace(/\n/g, '<br>')}</div>
    </div>
  `).join('');

  return `
    <div class="discussion-result pipeline-result">
      <div class="discussion-result-header" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));">
        <span class="discussion-result-icon">⚙️</span>
        <span>タスク: ${escapeHtml(result.task)}</span>
      </div>
      ${stagesHtml}
      <div class="discussion-report" style="border-top-color: var(--color-success);">
        <div class="discussion-report-header">✅ 最終成果物</div>
        <div class="discussion-report-content">${escapeHtml(result.deliverable).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  `;
}

