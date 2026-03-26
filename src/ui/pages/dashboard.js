import { listAgents, getAgent } from '../../core/agent.js';
import { listChannels, subscribeToChannel, sendMessage, handleAgentResponse } from '../../core/messageBus.js';
import { startHeartbeatLoop, stopAllHeartbeats } from '../../core/autonomy.js';
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
        ${state.selectedAgent ? renderAgentDetail(state.selectedAgent) : renderEmptyDetail()}
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

function renderAgentDetail(agent) {
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
      ${renderRelationships(agent)}
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

function renderRelationships(agent) {
  const rels = agent.relationships || {};
  if (Object.keys(rels).length === 0) {
    return '<div style="font-size: var(--text-xs); color: var(--color-text-muted);">まだ交流がありません</div>';
  }

  return Object.entries(rels).map(([id, rel]) => `
    <div class="relationship-item">
      <span class="relationship-label">${id.slice(0, 5)}...</span>
      <div class="relationship-score">
        <div class="relationship-score-fill" style="width: ${(rel.score ?? 0.5) * 100}%"></div>
      </div>
      <span class="relationship-value">${Math.round((rel.score ?? 0.5) * 100)}%</span>
    </div>
  `).join('');
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
        detailPanel.innerHTML = renderAgentDetail(state.selectedAgent);
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
    if (!content || !state.selectedChannel) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Send user message
    await sendMessage(state.worldId, state.selectedChannel.id, {
      content,
      senderId: state.user.uid,
      senderName: state.user.email?.split('@')[0] || 'User',
      senderType: 'user',
    });

    // Show typing indicator
    showTyping(state.agents.map((a) => a.name).join(', '));

    // Get agent responses
    for (const agent of state.agents) {
      try {
        await handleAgentResponse(state.worldId, agent.id, state.selectedChannel.id, {
          content,
          senderId: state.user.uid,
          senderName: state.user.email?.split('@')[0] || 'User',
          senderType: 'user',
        });
      } catch (error) {
        console.error(`[Chat] Agent ${agent.name} response failed:`, error);
      }
    }

    hideTyping();
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
              detailPanel.innerHTML = renderAgentDetail(state.selectedAgent);
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
            detailPanel.innerHTML = renderAgentDetail(updated);
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
