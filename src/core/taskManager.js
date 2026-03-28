/**
 * TaskManager — タスク管理モジュール (Phase 4)
 *
 * エージェントにタスクを割り当て、進捗管理するシステム。
 *
 * データモデル: worlds/{worldId}/tasks/{taskId}
 *
 * フロー:
 *   1. ユーザーがタスクを作成
 *   2. エージェントにアサイン
 *   3. executeTask() で LLM 呼び出し → 成果物を deliverables に追加
 *   4. チャンネルに進捗報告を自動投稿
 *   5. ステータス更新: pending → in_progress → review → completed
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';
import { chatWithModel } from '../services/aiService.js';
import { generateSystemPrompt } from './personality.js';
import { getAgent, listAgents } from './agent.js';
import { sendMessage } from './messageBus.js';

// --- 定数 ---

/** 有効なステータス */
export const TASK_STATUSES = ['pending', 'in_progress', 'review', 'completed', 'cancelled'];

/** 有効な優先度 */
export const TASK_PRIORITIES = ['low', 'medium', 'high'];

/** 許可されるステータス遷移マップ */
export const VALID_TRANSITIONS = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['review', 'completed', 'cancelled'],
  review: ['in_progress', 'completed', 'cancelled'],
  completed: [],   // 完了からの遷移は不可
  cancelled: ['pending'], // キャンセルから再開は可
};

/** ステータスの日本語ラベル */
export const STATUS_LABELS = {
  pending: '未着手',
  in_progress: '進行中',
  review: 'レビュー',
  completed: '完了',
  cancelled: 'キャンセル',
};

/** 優先度の日本語ラベルと表示用 */
export const PRIORITY_CONFIG = {
  high: { label: '高', color: '#f87171', emoji: '🔴' },
  medium: { label: '中', color: '#fbbf24', emoji: '🟡' },
  low: { label: '低', color: '#34d399', emoji: '🟢' },
};

// --- CRUD ---

/**
 * タスクを作成する
 * @param {string} worldId
 * @param {Object} taskData
 * @param {string} taskData.title - タスクタイトル（必須）
 * @param {string} [taskData.description] - 詳細説明
 * @param {string} [taskData.priority='medium'] - 優先度
 * @param {string} [taskData.assigneeId] - アサイン先エージェントID
 * @param {string} [taskData.assigneeName] - アサイン先エージェント名
 * @param {string} taskData.creatorId - 作成者ID（ユーザーUID）
 * @param {string[]} [taskData.tags] - タグ配列
 * @param {Date|null} [taskData.dueDate] - 期限
 * @returns {Promise<Object>} 作成されたタスク
 */
export async function createTask(worldId, taskData) {
  if (!taskData.title || !taskData.title.trim()) {
    throw new Error('タスクタイトルは必須です');
  }
  if (!taskData.creatorId) {
    throw new Error('作成者IDは必須です');
  }

  const db = getFirebaseDb();
  const ref = doc(collection(db, `worlds/${worldId}/tasks`));

  const task = {
    id: ref.id,
    title: taskData.title.trim(),
    description: taskData.description?.trim() || '',
    status: 'pending',
    priority: TASK_PRIORITIES.includes(taskData.priority) ? taskData.priority : 'medium',
    assigneeId: taskData.assigneeId || null,
    assigneeName: taskData.assigneeName || null,
    creatorId: taskData.creatorId,
    subtasks: taskData.subtasks || [],
    deliverables: [],
    activityLog: [{
      timestamp: new Date().toISOString(),
      agentId: null,
      action: 'created',
      detail: 'タスクが作成されました',
    }],
    tags: taskData.tags || [],
    dueDate: taskData.dueDate || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  };

  await setDoc(ref, task);
  return { ...task, id: ref.id };
}

/**
 * タスクを取得する
 * @param {string} worldId
 * @param {string} taskId
 * @returns {Promise<Object|null>}
 */
export async function getTask(worldId, taskId) {
  const db = getFirebaseDb();
  const docRef = doc(db, `worlds/${worldId}/tasks`, taskId);
  const snap = await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * ワールド内のタスク一覧を取得する
 * @param {string} worldId
 * @param {Object} [options]
 * @param {string} [options.status] - ステータスでフィルタ
 * @param {string} [options.assigneeId] - アサイン先でフィルタ
 * @param {string} [options.orderField='createdAt'] - ソートフィールド
 * @param {string} [options.orderDir='desc'] - ソート方向
 * @returns {Promise<Array<Object>>}
 */
export async function listTasks(worldId, options = {}) {
  const db = getFirebaseDb();
  const constraints = [];

  if (options.status) {
    constraints.push(where('status', '==', options.status));
  }
  if (options.assigneeId) {
    constraints.push(where('assigneeId', '==', options.assigneeId));
  }

  constraints.push(orderBy(options.orderField || 'createdAt', options.orderDir || 'desc'));

  const q = query(collection(db, `worlds/${worldId}/tasks`), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * タスクを更新する
 * @param {string} worldId
 * @param {string} taskId
 * @param {Object} updates
 * @returns {Promise<void>}
 */
export async function updateTask(worldId, taskId, updates) {
  const db = getFirebaseDb();
  const docRef = doc(db, `worlds/${worldId}/tasks`, taskId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/**
 * タスクを削除する
 * @param {string} worldId
 * @param {string} taskId
 * @returns {Promise<void>}
 */
export async function deleteTask(worldId, taskId) {
  const db = getFirebaseDb();
  const docRef = doc(db, `worlds/${worldId}/tasks`, taskId);
  await deleteDoc(docRef);
}

// --- ステータス管理 ---

/**
 * タスクのステータスを更新する（遷移バリデーションつき）
 * @param {string} worldId
 * @param {string} taskId
 * @param {string} newStatus
 * @param {string} [actorId] - 操作者のID（エージェント or ユーザー）
 * @returns {Promise<void>}
 */
export async function updateTaskStatus(worldId, taskId, newStatus, actorId = null) {
  if (!TASK_STATUSES.includes(newStatus)) {
    throw new Error(`無効なステータスです: ${newStatus}`);
  }

  const task = await getTask(worldId, taskId);
  if (!task) throw new Error(`タスクが見つかりません: ${taskId}`);

  const allowed = VALID_TRANSITIONS[task.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `ステータス遷移 "${STATUS_LABELS[task.status]}" → "${STATUS_LABELS[newStatus]}" は許可されていません`
    );
  }

  const updates = {
    status: newStatus,
    updatedAt: serverTimestamp(),
  };

  // 完了時に completedAt をセット
  if (newStatus === 'completed') {
    updates.completedAt = serverTimestamp();
  }

  // アクティビティログに追記
  const logEntry = {
    timestamp: new Date().toISOString(),
    agentId: actorId,
    action: 'status_changed',
    detail: `ステータスが "${STATUS_LABELS[task.status]}" → "${STATUS_LABELS[newStatus]}" に変更されました`,
  };
  updates.activityLog = [...(task.activityLog || []), logEntry];

  await updateTask(worldId, taskId, updates);
}

// --- アサイン ---

/**
 * タスクをエージェントにアサインする
 * @param {string} worldId
 * @param {string} taskId
 * @param {string} agentId
 * @returns {Promise<void>}
 */
export async function assignTask(worldId, taskId, agentId) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) throw new Error(`エージェントが見つかりません: ${agentId}`);

  const task = await getTask(worldId, taskId);
  if (!task) throw new Error(`タスクが見つかりません: ${taskId}`);

  const logEntry = {
    timestamp: new Date().toISOString(),
    agentId,
    action: 'assigned',
    detail: `${agent.name} にアサインされました`,
  };

  await updateTask(worldId, taskId, {
    assigneeId: agentId,
    assigneeName: agent.name,
    activityLog: [...(task.activityLog || []), logEntry],
  });
}

// --- 成果物 ---

/**
 * タスクに成果物を追加する
 * @param {string} worldId
 * @param {string} taskId
 * @param {Object} deliverable - { content, agentId, agentName }
 * @returns {Promise<void>}
 */
export async function addDeliverable(worldId, taskId, deliverable) {
  const task = await getTask(worldId, taskId);
  if (!task) throw new Error(`タスクが見つかりません: ${taskId}`);

  const entry = {
    id: `del-${Date.now()}`,
    content: deliverable.content,
    agentId: deliverable.agentId || null,
    agentName: deliverable.agentName || null,
    createdAt: new Date().toISOString(),
  };

  const logEntry = {
    timestamp: new Date().toISOString(),
    agentId: deliverable.agentId,
    action: 'deliverable_added',
    detail: `${deliverable.agentName || 'エージェント'} が成果物を提出しました`,
  };

  await updateTask(worldId, taskId, {
    deliverables: [...(task.deliverables || []), entry],
    activityLog: [...(task.activityLog || []), logEntry],
  });
}

/**
 * アクティビティログにエントリを追加する
 * @param {string} worldId
 * @param {string} taskId
 * @param {Object} logEntry - { agentId, action, detail }
 * @returns {Promise<void>}
 */
export async function addActivityLog(worldId, taskId, logEntry) {
  const task = await getTask(worldId, taskId);
  if (!task) throw new Error(`タスクが見つかりません: ${taskId}`);

  const entry = {
    timestamp: new Date().toISOString(),
    agentId: logEntry.agentId || null,
    action: logEntry.action,
    detail: logEntry.detail,
  };

  await updateTask(worldId, taskId, {
    activityLog: [...(task.activityLog || []), entry],
  });
}

// --- タスク実行 ---

/**
 * タスクを実行する（アサインされたエージェントが LLM で作業）
 * @param {string} worldId
 * @param {string} taskId
 * @param {Object} [options]
 * @param {string} [options.channelId] - 進捗報告先のチャンネルID
 * @param {Function} [options.onProgress] - 進捗コールバック
 * @returns {Promise<Object>} 実行結果 { content, agentName, status }
 */
export async function executeTask(worldId, taskId, options = {}) {
  const { channelId, onProgress } = options;

  const task = await getTask(worldId, taskId);
  if (!task) throw new Error(`タスクが見つかりません: ${taskId}`);

  // アサイン先が未設定の場合、最適なエージェントを自動選択
  let agentId = task.assigneeId;
  let agent;

  if (agentId) {
    agent = await getAgent(worldId, agentId);
  }

  if (!agent) {
    agent = await autoAssignAgent(worldId, task);
    agentId = agent.id;
    await assignTask(worldId, taskId, agentId);
  }

  // ステータスを進行中に
  if (task.status === 'pending') {
    await updateTaskStatus(worldId, taskId, 'in_progress', agentId);
  }

  if (onProgress) {
    onProgress({ step: 1, total: 3, agentName: agent.name, stageName: '準備中' });
  }

  // エージェントの性格に基づいたシステムプロンプト
  const systemPrompt = generateSystemPrompt(agent);
  const modelConfig = agent.preferredModel || { provider: 'huggingface' };

  // ロール別のタスク実行インストラクション
  const roleInstructions = {
    'リサーチャー': `以下のタスクについて、徹底的にリサーチし、調査レポートを作成してください。事実に基づいた情報のみ記載し、箇条書きと段落を組み合わせた読みやすい形式にしてください。`,
    'ライター': `以下のタスクについて、クリエイティブかつ読みやすい文章を作成してください。読者に価値を提供する内容にしてください。`,
    'マネージャー': `以下のタスクについて、実行計画を立て、アクションアイテムを整理してください。優先度と期限を意識した実践的な内容にしてください。`,
  };

  const instruction = roleInstructions[agent.role] || '以下のタスクを実行し、成果物を作成してください。';

  const userContent = `${instruction}

タスク: ${task.title}
${task.description ? `詳細: ${task.description}` : ''}

成果物を作成してください。Markdown形式で、構造化された読みやすい内容にしてください。`;

  if (onProgress) {
    onProgress({ step: 2, total: 3, agentName: agent.name, stageName: '作業中' });
  }

  let content;
  try {
    content = await chatWithModel([
      { role: 'system', content: `${systemPrompt}\n\n【タスク実行モード】あなたは今、チームの一員としてタスクを実行しています。` },
      { role: 'user', content: userContent },
    ], {
      provider: modelConfig.provider,
      model: modelConfig.model,
      temperature: 0.6,
      maxTokens: 1024,
    });
  } catch (error) {
    console.error(`[TaskManager] ${agent.name} task execution failed:`, error);
    content = generateTaskFallback(agent, task);
  }

  if (onProgress) {
    onProgress({ step: 3, total: 3, agentName: agent.name, stageName: '完了処理中' });
  }

  // 成果物を追加
  await addDeliverable(worldId, taskId, {
    content,
    agentId: agent.id,
    agentName: agent.name,
  });

  // チャンネルに進捗を自動投稿
  if (channelId) {
    await sendMessage(worldId, channelId, {
      content: `📋 タスク「${task.title}」の作業が完了しました。\n\n---\n${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`,
      senderId: agent.id,
      senderName: agent.name,
      senderType: 'agent',
    });
  }

  // ステータスをレビューに
  await updateTaskStatus(worldId, taskId, 'review', agentId);

  return {
    content,
    agentName: agent.name,
    agentId: agent.id,
    status: 'review',
  };
}

// --- リアルタイム購読 ---

/**
 * タスク一覧のリアルタイム購読
 * @param {string} worldId
 * @param {Function} callback - タスク配列を受け取るコールバック
 * @returns {Function} unsubscribe 関数
 */
export function subscribeToTasks(worldId, callback) {
  const db = getFirebaseDb();
  const q = query(
    collection(db, `worlds/${worldId}/tasks`),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(tasks);
  });
}

// --- ヘルパー ---

/**
 * タスクの内容に最適なエージェントを自動選択する
 * @param {string} worldId
 * @param {Object} task
 * @returns {Promise<Object>} 選択されたエージェント
 */
async function autoAssignAgent(worldId, task) {
  const agents = await listAgents(worldId);
  if (agents.length === 0) throw new Error('アサイン可能なエージェントがいません');

  const titleLower = (task.title + ' ' + task.description).toLowerCase();

  // キーワードマッチング
  const researchKeywords = ['調査', 'リサーチ', '分析', 'データ', '比較', '研究', 'research', 'analyze'];
  const writeKeywords = ['執筆', '記事', 'ブログ', 'レポート', '文章', 'write', 'blog', 'report', 'コンテンツ'];
  const manageKeywords = ['計画', 'プラン', 'スケジュール', '管理', '戦略', 'plan', 'manage', 'strategy'];

  const scores = agents.map((agent) => {
    let score = 0;
    const keywords = agent.role === 'リサーチャー' ? researchKeywords
      : agent.role === 'ライター' ? writeKeywords
      : agent.role === 'マネージャー' ? manageKeywords
      : [];

    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 1;
    }

    // エネルギーも考慮
    score += (agent.mood?.energy || 0.5) * 0.5;

    return { agent, score };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0].agent;
}

/**
 * タスク実行失敗時のフォールバック
 */
function generateTaskFallback(agent, task) {
  const fallbacks = {
    'リサーチャー': `タスク「${task.title}」について調査を開始しましたが、外部データの取得に問題が発生しました。手動での情報収集が必要です。`,
    'ライター': `タスク「${task.title}」の執筆に取り組みましたが、生成中にエラーが発生しました。テーマの詳細を追加していただければ再挑戦します。`,
    'マネージャー': `タスク「${task.title}」の計画策定中にエラーが発生しました。サブタスクの整理から始めることを推奨します。`,
  };
  return fallbacks[agent.role] || `タスク「${task.title}」の実行中にエラーが発生しました。再試行してください。`;
}
