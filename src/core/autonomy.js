import { getAgent, listAgents, updateAgent, updateMood } from './agent.js';
import { getRecentMemories } from './memory.js';
import { listChannels, sendMessage, handleAgentResponse } from './messageBus.js';
import { chat } from '../services/hfService.js';
import { generateSystemPrompt } from './personality.js';

/** アクティブなハートビートループの管理 */
const activeLoops = new Map();

/**
 * 1回のハートビートサイクルを実行する
 * エージェントが「今何をすべきか」を自律的に判断し、行動する
 *
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<Object>} 実行結果 { action, detail }
 */
export async function heartbeat(worldId, agentId) {
  const agent = await getAgent(worldId, agentId);
  if (!agent) return { action: 'skip', detail: 'Agent not found' };

  // コンテキスト収集
  const context = await collectContext(worldId, agentId);

  // LLM に判断を委ねる
  const decision = await decide(agent, context);

  // アクション実行
  const result = await executeAction(worldId, agentId, agent, decision, context);

  // エネルギー微減（活動コスト）
  await updateMood(worldId, agentId, {
    energy: Math.max(0.1, agent.mood.energy - 0.03),
  });

  return result;
}

/**
 * ハートビートの状況コンテキストを収集する
 * @param {string} worldId
 * @param {string} agentId
 * @returns {Promise<Object>}
 */
export async function collectContext(worldId, agentId) {
  const [agents, channels, recentMemories] = await Promise.all([
    listAgents(worldId),
    listChannels(worldId),
    getRecentMemories(worldId, agentId, 5),
  ]);

  return {
    otherAgents: agents.filter((a) => a.id !== agentId),
    channels,
    recentMemories,
    timestamp: new Date().toISOString(),
  };
}

/**
 * エージェントが何をすべきか判断する
 * @param {Object} agent
 * @param {Object} context
 * @returns {Promise<Object>} { action, target, topic }
 */
async function decide(agent, context) {
  const systemPrompt = generateSystemPrompt(agent);

  const contextSummary = buildContextSummary(agent, context);

  const decisionPrompt = `${contextSummary}

以下のアクションから1つだけ選んでください。JSON形式で回答してください:

選択肢:
1. {"action": "message", "target": "チャンネルID", "topic": "話題"}
   → チャンネルにメッセージを投稿する
2. {"action": "react", "target": "エージェントID", "topic": "反応内容"}
   → 他のエージェントの最近の発言に反応する
3. {"action": "idle", "target": null, "topic": null}
   → 何もしない（エネルギーが低い時、話題がない時）

判断基準:
- エネルギーが${agent.mood.energy < 0.3 ? '低い' : '十分ある'}
- ストレスが${agent.mood.stress > 0.6 ? '高い' : '低い'}
- あなたの性格に基づいて自然な行動を選んでください
- 外向性が${agent.personality.extraversion > 0.6 ? '高い' : '低い'}ので、${agent.personality.extraversion > 0.6 ? '積極的に交流する傾向がある' : '静かに過ごす傾向がある'}

JSON形式で回答してください:`;

  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: decisionPrompt },
    ], {
      temperature: 0.5,
      maxTokens: 100,
    });

    return parseDecision(response, context);
  } catch (error) {
    console.warn(`[Autonomy] Decision failed for ${agent.name}:`, error.message);
    return makeFallbackDecision(agent, context);
  }
}

/**
 * 判断に基づいてアクションを実行する
 * @param {string} worldId
 * @param {string} agentId
 * @param {Object} agent
 * @param {Object} decision - { action, target, topic }
 * @param {Object} context
 * @returns {Promise<Object>}
 */
export async function executeAction(worldId, agentId, agent, decision, context) {
  switch (decision.action) {
    case 'message': {
      const channelId = decision.target || context.channels[0]?.id;
      if (!channelId) return { action: 'skip', detail: 'No channel available' };

      // 話題に基づいてメッセージを生成
      const systemPrompt = generateSystemPrompt(agent);
      let messageContent;

      try {
        messageContent = await chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `以下の話題について、あなたらしく1-2文でコメントしてください: ${decision.topic || '何か面白いこと'}` },
        ], {
          temperature: 0.7,
          maxTokens: 128,
        });
      } catch {
        messageContent = getRandomTopicMessage(agent);
      }

      await sendMessage(worldId, channelId, {
        content: messageContent,
        senderId: agentId,
        senderName: agent.name,
        senderType: 'agent',
      });

      // 統計更新
      await updateAgent(worldId, agentId, {
        'stats.autonomousActions': (agent.stats?.autonomousActions || 0) + 1,
        status: 'active',
      });

      return { action: 'message', detail: `Sent message to channel: ${messageContent.slice(0, 50)}...` };
    }

    case 'react': {
      // 他のエージェントのメッセージに反応
      const targetAgent = context.otherAgents.find((a) => a.id === decision.target);
      if (!targetAgent) return { action: 'skip', detail: 'Target agent not found' };

      const channelId = context.channels[0]?.id;
      if (!channelId) return { action: 'skip', detail: 'No channel for reaction' };

      // Fake incoming message to trigger response flow
      await handleAgentResponse(worldId, agentId, channelId, {
        content: decision.topic || `${targetAgent.name}の最近の話が気になる`,
        senderId: targetAgent.id,
        senderName: targetAgent.name,
        senderType: 'agent',
      });

      return { action: 'react', detail: `Reacted to ${targetAgent.name}` };
    }

    case 'idle':
    default:
      await updateAgent(worldId, agentId, { status: 'idle' });
      return { action: 'idle', detail: 'Chose to rest' };
  }
}

/**
 * ハートビートループを開始する
 * @param {string} worldId
 * @param {string} agentId
 * @param {number} [intervalMs=30000] - ハートビート間隔（ミリ秒）
 * @returns {string} ループID
 */
export function startHeartbeatLoop(worldId, agentId, intervalMs = 30000) {
  const loopId = `${worldId}:${agentId}`;

  if (activeLoops.has(loopId)) {
    console.warn(`[Autonomy] Heartbeat loop already active for ${loopId}`);
    return loopId;
  }

  const intervalId = setInterval(async () => {
    try {
      const result = await heartbeat(worldId, agentId);
      console.log(`[Autonomy] ${agentId}: ${result.action} - ${result.detail}`);
    } catch (error) {
      console.error(`[Autonomy] Heartbeat error for ${agentId}:`, error);
    }
  }, intervalMs);

  activeLoops.set(loopId, intervalId);
  console.log(`[Autonomy] Started heartbeat for ${agentId} (interval: ${intervalMs}ms)`);
  return loopId;
}

/**
 * ハートビートループを停止する
 * @param {string} worldId
 * @param {string} agentId
 */
export function stopHeartbeatLoop(worldId, agentId) {
  const loopId = `${worldId}:${agentId}`;
  const intervalId = activeLoops.get(loopId);

  if (intervalId) {
    clearInterval(intervalId);
    activeLoops.delete(loopId);
    console.log(`[Autonomy] Stopped heartbeat for ${agentId}`);
  }
}

/**
 * 全ハートビートループを停止する
 */
export function stopAllHeartbeats() {
  for (const [loopId, intervalId] of activeLoops) {
    clearInterval(intervalId);
    console.log(`[Autonomy] Stopped heartbeat: ${loopId}`);
  }
  activeLoops.clear();
}

// --- ヘルパー関数 ---

function buildContextSummary(agent, context) {
  const agentList = context.otherAgents
    .map((a) => `- ${a.name} (${a.role}): ${a.status}, energy=${a.mood?.energy?.toFixed(1)}`)
    .join('\n');

  const channelList = context.channels
    .map((c) => `- #${c.name}: 最新 "${c.lastMessage?.content?.slice(0, 30) || '(空)'}"`)
    .join('\n');

  const memoryList = context.recentMemories
    .slice(0, 3)
    .map((m) => `- ${m.content?.slice(0, 50)}`)
    .join('\n');

  return `現在の状況:

【仲間】
${agentList || '(なし)'}

【チャンネル】
${channelList || '(なし)'}

【最近の記憶】
${memoryList || '(なし)'}
`;
}

function parseDecision(response, context) {
  try {
    // JSON部分を抽出
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (['message', 'react', 'idle'].includes(parsed.action)) {
        return parsed;
      }
    }
  } catch {
    // パース失敗
  }
  return { action: 'idle', target: null, topic: null };
}

function makeFallbackDecision(agent, context) {
  // エネルギーが低い → idle
  if (agent.mood.energy < 0.3) return { action: 'idle', target: null, topic: null };

  // 外向性が高い → message
  if (agent.personality.extraversion > 0.6 && context.channels.length > 0) {
    return {
      action: 'message',
      target: context.channels[0].id,
      topic: '最近気になっていること',
    };
  }

  return { action: 'idle', target: null, topic: null };
}

function getRandomTopicMessage(agent) {
  const topics = {
    リサーチャー: ['最近面白い発見がありました。', '新しいデータを見つけたかもしれません。'],
    ライター: ['良いフレーズが思い浮かびました。', '今日は筆が乗りそうです。'],
    マネージャー: ['進捗どうですか？', '今日のタスクを整理しましょう。'],
  };
  const pool = topics[agent.role] || ['こんにちは。'];
  return pool[Math.floor(Math.random() * pool.length)];
}
