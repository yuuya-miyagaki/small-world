import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firebase モック
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-task-id' })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(() => ({ docs: [] })),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
}));

vi.mock('../../src/config/firebase.js', () => ({
  getFirebaseDb: vi.fn(() => ({})),
}));

vi.mock('../../src/services/aiService.js', () => ({
  chatWithModel: vi.fn(() => Promise.resolve('AI生成された成果物コンテンツ')),
}));

vi.mock('../../src/core/personality.js', () => ({
  generateSystemPrompt: vi.fn(() => 'テスト用システムプロンプト'),
}));

vi.mock('../../src/core/agent.js', () => ({
  getAgent: vi.fn(),
  listAgents: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../src/core/messageBus.js', () => ({
  sendMessage: vi.fn(() => Promise.resolve()),
}));

import { setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getAgent, listAgents } from '../../src/core/agent.js';
import { chatWithModel } from '../../src/services/aiService.js';
import { sendMessage } from '../../src/core/messageBus.js';

// --- テスト用ヘルパー ---

function mockTaskDoc(taskData) {
  return {
    exists: () => true,
    id: taskData.id || 'task-1',
    data: () => taskData,
  };
}

function mockMissingDoc() {
  return { exists: () => false };
}

const MOCK_AGENT = {
  id: 'agent-rex',
  name: 'Rex',
  role: 'マネージャー',
  personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.9, agreeableness: 0.6, neuroticism: 0.2 },
  mood: { energy: 0.7, stress: 0.3 },
  preferredModel: { provider: 'huggingface', model: 'test-model' },
};

const MOCK_RESEARCHER = {
  id: 'agent-kai',
  name: 'Kai',
  role: 'リサーチャー',
  personality: { openness: 0.9, conscientiousness: 0.7, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  mood: { energy: 0.8, stress: 0.2 },
  preferredModel: { provider: 'huggingface', model: 'research-model' },
};

const MOCK_WRITER = {
  id: 'agent-mia',
  name: 'Mia',
  role: 'ライター',
  personality: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.4 },
  mood: { energy: 0.6, stress: 0.4 },
  preferredModel: { provider: 'huggingface', model: 'writer-model' },
};

// --- テスト ---

describe('TaskManager', () => {
  let taskModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    // resetAllMocks は全実装をクリアするため、デフォルトのモック実装を再設定
    getDocs.mockResolvedValue({ docs: [] });
    setDoc.mockResolvedValue(undefined);
    updateDoc.mockResolvedValue(undefined);
    deleteDoc.mockResolvedValue(undefined);
    taskModule = await import('../../src/core/taskManager.js');
  });

  // =========================================
  //  定数テスト
  // =========================================
  describe('Constants', () => {
    it('TASK_STATUSES should contain all valid statuses', () => {
      expect(taskModule.TASK_STATUSES).toEqual([
        'pending', 'in_progress', 'review', 'completed', 'cancelled',
      ]);
    });

    it('TASK_PRIORITIES should contain low, medium, high', () => {
      expect(taskModule.TASK_PRIORITIES).toEqual(['low', 'medium', 'high']);
    });

    it('VALID_TRANSITIONS should define correct transitions', () => {
      const t = taskModule.VALID_TRANSITIONS;
      expect(t.pending).toContain('in_progress');
      expect(t.pending).toContain('cancelled');
      expect(t.in_progress).toContain('review');
      expect(t.in_progress).toContain('completed');
      expect(t.completed).toEqual([]);
      expect(t.cancelled).toContain('pending');
    });

    it('STATUS_LABELS should have Japanese labels for all statuses', () => {
      const labels = taskModule.STATUS_LABELS;
      expect(labels.pending).toBe('未着手');
      expect(labels.in_progress).toBe('進行中');
      expect(labels.review).toBe('レビュー');
      expect(labels.completed).toBe('完了');
      expect(labels.cancelled).toBe('キャンセル');
    });

    it('PRIORITY_CONFIG should have emoji and color for each priority', () => {
      const config = taskModule.PRIORITY_CONFIG;
      expect(config.high.emoji).toBe('🔴');
      expect(config.medium.emoji).toBe('🟡');
      expect(config.low.emoji).toBe('🟢');
      expect(config.high.color).toMatch(/^#/);
    });
  });

  // =========================================
  //  createTask
  // =========================================
  describe('createTask', () => {
    it('should create a task with required fields', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await taskModule.createTask('world-1', {
        title: 'テストタスク',
        creatorId: 'user-1',
      });

      expect(setDoc).toHaveBeenCalledTimes(1);
      expect(result.title).toBe('テストタスク');
      expect(result.status).toBe('pending');
      expect(result.priority).toBe('medium');
      expect(result.creatorId).toBe('user-1');
      expect(result.deliverables).toEqual([]);
      expect(result.activityLog).toHaveLength(1);
      expect(result.activityLog[0].action).toBe('created');
    });

    it('should use provided optional fields', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await taskModule.createTask('world-1', {
        title: '高優先度タスク',
        description: '詳細な説明',
        priority: 'high',
        assigneeId: 'agent-rex',
        assigneeName: 'Rex',
        creatorId: 'user-1',
        tags: ['重要', 'マーケティング'],
      });

      expect(result.description).toBe('詳細な説明');
      expect(result.priority).toBe('high');
      expect(result.assigneeId).toBe('agent-rex');
      expect(result.assigneeName).toBe('Rex');
      expect(result.tags).toEqual(['重要', 'マーケティング']);
    });

    it('should default to medium when invalid priority is provided', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await taskModule.createTask('world-1', {
        title: '無効な優先度',
        priority: 'ultra-high',
        creatorId: 'user-1',
      });

      expect(result.priority).toBe('medium');
    });

    it('should throw when title is empty', async () => {
      await expect(
        taskModule.createTask('world-1', { title: '', creatorId: 'user-1' })
      ).rejects.toThrow('タスクタイトルは必須です');
    });

    it('should throw when title is whitespace only', async () => {
      await expect(
        taskModule.createTask('world-1', { title: '   ', creatorId: 'user-1' })
      ).rejects.toThrow('タスクタイトルは必須です');
    });

    it('should throw when creatorId is missing', async () => {
      await expect(
        taskModule.createTask('world-1', { title: 'タスク' })
      ).rejects.toThrow('作成者IDは必須です');
    });

    it('should trim title and description', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await taskModule.createTask('world-1', {
        title: '  前後にスペース  ',
        description: '  説明もトリム  ',
        creatorId: 'user-1',
      });

      expect(result.title).toBe('前後にスペース');
      expect(result.description).toBe('説明もトリム');
    });

    it('should set completedAt to null on creation', async () => {
      setDoc.mockResolvedValue(undefined);

      const result = await taskModule.createTask('world-1', {
        title: '新規タスク',
        creatorId: 'user-1',
      });

      expect(result.completedAt).toBeNull();
    });
  });

  // =========================================
  //  getTask
  // =========================================
  describe('getTask', () => {
    it('should return task data when found', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'テストタスク',
        status: 'pending',
      }));

      const result = await taskModule.getTask('world-1', 'task-1');
      expect(result).toEqual({
        id: 'task-1',
        title: 'テストタスク',
        status: 'pending',
      });
    });

    it('should return null when task not found', async () => {
      getDoc.mockResolvedValue(mockMissingDoc());

      const result = await taskModule.getTask('world-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  // =========================================
  //  listTasks
  // =========================================
  describe('listTasks', () => {
    it('should return all tasks ordered by createdAt desc', async () => {
      getDocs.mockResolvedValue({
        docs: [
          { id: 'task-1', data: () => ({ title: 'タスク1', status: 'pending' }) },
          { id: 'task-2', data: () => ({ title: 'タスク2', status: 'completed' }) },
        ],
      });

      const result = await taskModule.listTasks('world-1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('task-1');
      expect(result[1].id).toBe('task-2');
    });

    it('should return empty array when no tasks exist', async () => {
      getDocs.mockResolvedValue({ docs: [] });

      const result = await taskModule.listTasks('world-1');
      expect(result).toEqual([]);
    });
  });

  // =========================================
  //  updateTask
  // =========================================
  describe('updateTask', () => {
    it('should call updateDoc with updates and timestamp', async () => {
      updateDoc.mockResolvedValue(undefined);

      await taskModule.updateTask('world-1', 'task-1', { title: '更新済み' });

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.title).toBe('更新済み');
      expect(updates.updatedAt).toBeDefined();
    });
  });

  // =========================================
  //  deleteTask
  // =========================================
  describe('deleteTask', () => {
    it('should call deleteDoc', async () => {
      deleteDoc.mockResolvedValue(undefined);

      await taskModule.deleteTask('world-1', 'task-1');
      expect(deleteDoc).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================
  //  updateTaskStatus
  // =========================================
  describe('updateTaskStatus', () => {
    it('should allow valid transition: pending → in_progress', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'タスク',
        status: 'pending',
        activityLog: [{ action: 'created' }],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.updateTaskStatus('world-1', 'task-1', 'in_progress', 'agent-1');

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.status).toBe('in_progress');
      expect(updates.activityLog).toHaveLength(2);
      expect(updates.activityLog[1].action).toBe('status_changed');
    });

    it('should allow valid transition: in_progress → review', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'タスク',
        status: 'in_progress',
        activityLog: [],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.updateTaskStatus('world-1', 'task-1', 'review');

      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.status).toBe('review');
    });

    it('should set completedAt when transitioning to completed', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'タスク',
        status: 'in_progress',
        activityLog: [],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.updateTaskStatus('world-1', 'task-1', 'completed');

      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.status).toBe('completed');
      expect(updates.completedAt).toBeDefined();
    });

    it('should reject invalid transition: pending → completed', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'タスク',
        status: 'pending',
        activityLog: [],
      }));

      await expect(
        taskModule.updateTaskStatus('world-1', 'task-1', 'completed')
      ).rejects.toThrow('許可されていません');
    });

    it('should reject transition from completed (terminal state)', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'タスク',
        status: 'completed',
        activityLog: [],
      }));

      await expect(
        taskModule.updateTaskStatus('world-1', 'task-1', 'pending')
      ).rejects.toThrow('許可されていません');
    });

    it('should reject invalid status values', async () => {
      await expect(
        taskModule.updateTaskStatus('world-1', 'task-1', 'invalid_status')
      ).rejects.toThrow('無効なステータスです');
    });

    it('should throw when task not found', async () => {
      getDoc.mockResolvedValue(mockMissingDoc());

      await expect(
        taskModule.updateTaskStatus('world-1', 'nonexistent', 'in_progress')
      ).rejects.toThrow('タスクが見つかりません');
    });

    it('should allow cancelled → pending (reopen)', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'キャンセル済みタスク',
        status: 'cancelled',
        activityLog: [],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.updateTaskStatus('world-1', 'task-1', 'pending');

      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.status).toBe('pending');
    });
  });

  // =========================================
  //  assignTask
  // =========================================
  describe('assignTask', () => {
    it('should assign an agent to a task', async () => {
      getAgent.mockResolvedValue(MOCK_AGENT);
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'アサインテスト',
        status: 'pending',
        activityLog: [{ action: 'created' }],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.assignTask('world-1', 'task-1', 'agent-rex');

      expect(getAgent).toHaveBeenCalledWith('world-1', 'agent-rex');
      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.assigneeId).toBe('agent-rex');
      expect(updates.assigneeName).toBe('Rex');
      expect(updates.activityLog).toHaveLength(2);
      expect(updates.activityLog[1].action).toBe('assigned');
    });

    it('should throw when agent is not found', async () => {
      getAgent.mockResolvedValue(null);

      await expect(
        taskModule.assignTask('world-1', 'task-1', 'nonexistent')
      ).rejects.toThrow('エージェントが見つかりません');
    });

    it('should throw when task is not found', async () => {
      getAgent.mockResolvedValue(MOCK_AGENT);
      getDoc.mockResolvedValue(mockMissingDoc());

      await expect(
        taskModule.assignTask('world-1', 'nonexistent', 'agent-rex')
      ).rejects.toThrow('タスクが見つかりません');
    });
  });

  // =========================================
  //  addDeliverable
  // =========================================
  describe('addDeliverable', () => {
    it('should add a deliverable to a task', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: '成果物テスト',
        deliverables: [],
        activityLog: [],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.addDeliverable('world-1', 'task-1', {
        content: 'テスト成果物の内容',
        agentId: 'agent-kai',
        agentName: 'Kai',
      });

      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.deliverables).toHaveLength(1);
      expect(updates.deliverables[0].content).toBe('テスト成果物の内容');
      expect(updates.deliverables[0].agentId).toBe('agent-kai');
      expect(updates.deliverables[0].agentName).toBe('Kai');
      expect(updates.deliverables[0].id).toMatch(/^del-/);
      expect(updates.activityLog).toHaveLength(1);
      expect(updates.activityLog[0].action).toBe('deliverable_added');
    });

    it('should append to existing deliverables', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: '追記テスト',
        deliverables: [{ id: 'del-existing', content: '既存成果物' }],
        activityLog: [{ action: 'created' }],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.addDeliverable('world-1', 'task-1', {
        content: '追加成果物',
        agentId: 'agent-mia',
        agentName: 'Mia',
      });

      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.deliverables).toHaveLength(2);
    });

    it('should throw when task not found', async () => {
      getDoc.mockResolvedValue(mockMissingDoc());

      await expect(
        taskModule.addDeliverable('world-1', 'nonexistent', {
          content: 'テスト',
        })
      ).rejects.toThrow('タスクが見つかりません');
    });
  });

  // =========================================
  //  addActivityLog
  // =========================================
  describe('addActivityLog', () => {
    it('should add an activity log entry', async () => {
      getDoc.mockResolvedValue(mockTaskDoc({
        title: 'ログテスト',
        activityLog: [{ action: 'created' }],
      }));
      updateDoc.mockResolvedValue(undefined);

      await taskModule.addActivityLog('world-1', 'task-1', {
        agentId: 'agent-rex',
        action: 'comment',
        detail: 'テストコメント',
      });

      const [, updates] = updateDoc.mock.calls[0];
      expect(updates.activityLog).toHaveLength(2);
      expect(updates.activityLog[1].action).toBe('comment');
      expect(updates.activityLog[1].detail).toBe('テストコメント');
      expect(updates.activityLog[1].timestamp).toBeDefined();
    });
  });

  // =========================================
  //  executeTask
  // =========================================
  describe('executeTask', () => {
    /**
     * executeTask の getDoc 呼び出しフロー（assignee ありの場合）:
     *   #1 getTask (初回)               → pending
     *   #2 updateTaskStatus getTask     → pending  (pending → in_progress OK)
     *   #3 addDeliverable getTask       → in_progress (ステータス不問)
     *   #4 updateTaskStatus getTask     → in_progress (in_progress → review OK)
     *
     * assignee 無し（auto-assign）の場合は assignTask 内にも getDoc：
     *   #1 getTask (初回)               → pending
     *   #2 assignTask → getTask         → pending (ステータス不問)
     *   #3 updateTaskStatus getTask     → pending  (pending → in_progress OK)
     *   #4 addDeliverable getTask       → in_progress
     *   #5 updateTaskStatus getTask     → in_progress (in_progress → review OK)
     */

    function createGetDocSequence(taskBase, statusSequence) {
      let callCount = 0;
      getDoc.mockImplementation(() => {
        const status = statusSequence[callCount] || statusSequence[statusSequence.length - 1];
        callCount++;
        return Promise.resolve(mockTaskDoc({ ...taskBase, status }));
      });
    }

    it('should execute a task with assigned agent', async () => {
      const taskBase = {
        title: '市場調査レポート',
        description: 'AI市場の調査',
        assigneeId: 'agent-kai',
        activityLog: [],
        deliverables: [],
      };
      // 4 calls: getTask, updateTaskStatus→getTask, addDeliverable→getTask, updateTaskStatus→getTask
      createGetDocSequence(taskBase, ['pending', 'pending', 'in_progress', 'in_progress']);
      getAgent.mockResolvedValue(MOCK_RESEARCHER);
      chatWithModel.mockResolvedValue('# 調査レポート\n\n詳細な調査結果...');

      const result = await taskModule.executeTask('world-1', 'task-1');

      expect(result.content).toContain('調査レポート');
      expect(result.agentName).toBe('Kai');
      expect(result.status).toBe('review');
      expect(chatWithModel).toHaveBeenCalledTimes(1);
    });

    it('should auto-assign when no agent is assigned', async () => {
      const taskBase = {
        title: 'リサーチタスク',
        description: 'データ分析',
        assigneeId: null,
        activityLog: [],
        deliverables: [],
      };
      // 5 calls: getTask, assignTask→getTask, updateTaskStatus→getTask, addDeliverable→getTask, updateTaskStatus→getTask
      createGetDocSequence(taskBase, ['pending', 'pending', 'pending', 'in_progress', 'in_progress']);
      // executeTask: agentId = null → if(agentId) は false → agent = undefined
      // → autoAssignAgent → listAgents → MOCK_RESEARCHER を選択
      // → assignTask(worldId, taskId, MOCK_RESEARCHER.id)
      //   → getAgent(worldId, 'agent-kai') → MOCK_RESEARCHER
      //   → getTask (getDoc #2)
      getAgent.mockResolvedValue(MOCK_RESEARCHER);
      listAgents.mockResolvedValue([MOCK_RESEARCHER, MOCK_WRITER, MOCK_AGENT]);
      chatWithModel.mockResolvedValue('自動アサインの成果物');

      const result = await taskModule.executeTask('world-1', 'task-1');

      expect(listAgents).toHaveBeenCalled();
      expect(result.content).toBe('自動アサインの成果物');
    });

    it('should post to channel when channelId is provided', async () => {
      const taskBase = {
        title: 'チャンネル通知テスト',
        description: '',
        assigneeId: 'agent-mia',
        activityLog: [],
        deliverables: [],
      };
      createGetDocSequence(taskBase, ['pending', 'pending', 'in_progress', 'in_progress']);
      getAgent.mockResolvedValue(MOCK_WRITER);
      chatWithModel.mockResolvedValue('執筆成果物');

      await taskModule.executeTask('world-1', 'task-1', {
        channelId: 'channel-main',
      });

      expect(sendMessage).toHaveBeenCalledWith(
        'world-1',
        'channel-main',
        expect.objectContaining({
          senderId: MOCK_WRITER.id,
          senderName: 'Mia',
          senderType: 'agent',
        }),
      );
    });

    it('should call onProgress callback during execution', async () => {
      const taskBase = {
        title: 'プログレステスト',
        description: '',
        assigneeId: 'agent-rex',
        activityLog: [],
        deliverables: [],
      };
      createGetDocSequence(taskBase, ['pending', 'pending', 'in_progress', 'in_progress']);
      getAgent.mockResolvedValue(MOCK_AGENT);
      chatWithModel.mockResolvedValue('進捗テスト成果物');

      const onProgress = vi.fn();
      await taskModule.executeTask('world-1', 'task-1', { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ step: 1, total: 3, stageName: '準備中' }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ step: 2, total: 3, stageName: '作業中' }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ step: 3, total: 3, stageName: '完了処理中' }),
      );
    });

    it('should use fallback content when AI call fails', async () => {
      const taskBase = {
        title: 'AIエラーテスト',
        description: '',
        assigneeId: 'agent-kai',
        activityLog: [],
        deliverables: [],
      };
      createGetDocSequence(taskBase, ['pending', 'pending', 'in_progress', 'in_progress']);
      getAgent.mockResolvedValue(MOCK_RESEARCHER);
      chatWithModel.mockRejectedValue(new Error('API quota exceeded'));

      const result = await taskModule.executeTask('world-1', 'task-1');

      expect(result.content).toContain('AIエラーテスト');
      expect(result.status).toBe('review');
    });

    it('should throw when task not found', async () => {
      getDoc.mockResolvedValue(mockMissingDoc());

      await expect(
        taskModule.executeTask('world-1', 'nonexistent')
      ).rejects.toThrow('タスクが見つかりません');
    });
  });

  // =========================================
  //  subscribeToTasks
  // =========================================
  describe('subscribeToTasks', () => {
    it('should set up onSnapshot listener', () => {
      onSnapshot.mockReturnValue(vi.fn());

      const callback = vi.fn();
      const unsub = taskModule.subscribeToTasks('world-1', callback);

      expect(onSnapshot).toHaveBeenCalledTimes(1);
      expect(typeof unsub).toBe('function');
    });
  });
});
