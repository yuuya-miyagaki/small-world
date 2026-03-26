/**
 * Collective — 議論エンジン (Phase 2c)
 *
 * ユーザーがテーマを投げる → 3体のエージェントが多角的に議論 → レポート出力
 *
 * 設計方針（Cross-AI分析に基づく）:
 * - handleAgentResponse() を流用しない（独立モジュール）
 * - 2ラウンド固定 + レポート1回 = 7 API calls
 * - 議論中はハートビート停止、感情分析スキップ
 * - 合意形成はLLM 1回要約
 */

import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../config/firebase.js';
import { chat } from '../services/aiService.js';
import { generateSystemPrompt } from './personality.js';
import { listAgents, getAgent } from './agent.js';
import { stopHeartbeatLoop, startHeartbeatLoop } from './autonomy.js';

/**
 * 議論設定
 */
export const DISCUSSION_CONFIG = {
  ROUNDS: 2,
  GENERATE_REPORT: true,
  MAX_TOKENS_DISCUSSION: 512,
  MAX_TOKENS_REPORT: 1024,
};

/**
 * 議論モード専用のプロンプト補足
 * 高Agreeablenessのエージェントには批判的視点を持たせる
 */
function getDebateOverride(agent) {
  const overrides = [];

  // 協調性が高いエージェントには批判的視点を促す
  if (agent.personality.agreeableness > 0.7) {
    overrides.push(
      '【議論モード】この議論では、同意だけでなく批判的な視点も積極的に出してください。' +
      '他のメンバーの意見に対して「でも〜という問題もあるんじゃないかな」と建設的に反論することが大切です。'
    );
  }

  // ロール別の議論スタンス
  const roleStances = {
    リサーチャー: 'データや根拠に基づいた分析的な意見を出してください。感覚的な意見には「根拠は？」と問いかけてください。',
    ライター: '読者・ユーザーの目線で意見を出してください。難しい話には「もっとシンプルに言うと？」と切り込んでください。',
    マネージャー: '実行可能性とコストの観点から意見を出してください。理想論には「で、具体的にどう進める？」と聞いてください。',
  };

  if (roleStances[agent.role]) {
    overrides.push(roleStances[agent.role]);
  }

  return overrides.join('\n');
}

/**
 * 議論セッションを開始する
 * @param {string} worldId
 * @param {string} theme - 議論テーマ
 * @param {Object} [options] - { onProgress: Function }
 * @returns {Promise<Object>} 完了したセッション
 */
export async function startDiscussion(worldId, theme, options = {}) {
  const { onProgress } = options;
  const agents = await listAgents(worldId);

  if (agents.length === 0) {
    throw new Error('議論するエージェントがいません');
  }

  // ハートビートを停止（レート制限キュー競合防止）
  for (const agent of agents) {
    stopHeartbeatLoop(agent.id);
  }

  // セッション初期化
  const session = {
    id: null,
    worldId,
    theme,
    agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
    rounds: [],
    report: null,
    status: 'in_progress',
    createdAt: new Date().toISOString(),
  };

  // Firestoreにセッション保存
  try {
    const db = getFirebaseDb();
    const ref = doc(collection(db, `worlds/${worldId}/discussions`));
    session.id = ref.id;
    await setDoc(ref, { ...session, createdAt: serverTimestamp() });
  } catch {
    session.id = `local-${Date.now()}`;
  }

  let stepCount = 0;
  const totalSteps = agents.length * DISCUSSION_CONFIG.ROUNDS;

  // ラウンド実行
  for (let roundNum = 1; roundNum <= DISCUSSION_CONFIG.ROUNDS; roundNum++) {
    const round = {
      roundNumber: roundNum,
      contributions: [],
    };

    for (const agent of agents) {
      stepCount++;
      if (onProgress) {
        onProgress({ step: stepCount, total: totalSteps, agentName: agent.name, round: roundNum });
      }

      const contribution = await generateContribution(agent, theme, session.rounds, roundNum);
      round.contributions.push(contribution);
    }

    session.rounds.push(round);
  }

  session.status = 'completed';

  // Firestoreに完了状態を保存
  try {
    const db = getFirebaseDb();
    const ref = doc(db, `worlds/${worldId}/discussions`, session.id);
    await setDoc(ref, { ...session, completedAt: serverTimestamp() }, { merge: true });
  } catch {
    // 保存失敗は無視（ローカルセッションとして続行）
  }

  return session;
}

/**
 * 1つのエージェントの議論への貢献を生成する
 */
async function generateContribution(agent, theme, previousRounds, currentRound) {
  const fullAgent = await getAgent(agent.id ? undefined : null, agent.id) || agent;
  const basePrompt = generateSystemPrompt(fullAgent);
  const debateOverride = getDebateOverride(fullAgent);

  // システムプロンプト構築
  const systemContent = `${basePrompt}\n\n${debateOverride}`;

  // ユーザーメッセージ構築
  let userContent;

  if (currentRound === 1) {
    // ラウンド1: テーマのみで初期意見
    userContent = `以下のテーマについて、あなたの立場（${fullAgent.role}）から意見を述べてください。\n\nテーマ: ${theme}\n\n2-4文で簡潔に、あなたらしい口調で答えてください。`;
  } else {
    // ラウンド2以降: 全員の発言を見て反応
    const allContributions = previousRounds
      .flatMap((r) => r.contributions)
      .map((c) => `${c.agentName}（${c.role}）: ${c.content}`)
      .join('\n\n');

    userContent = `以下のテーマについて議論しています。他のメンバーの意見を踏まえて、反論・補足・同意など、あなたの立場（${fullAgent.role}）から意見を述べてください。\n\nテーマ: ${theme}\n\n--- これまでの議論 ---\n${allContributions}\n\n2-4文で簡潔に、あなたらしい口調で答えてください。他のメンバーの名前を出して具体的に反応してください。`;
  }

  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  let content;
  try {
    content = await chat(messages, {
      temperature: 0.7 + fullAgent.personality.openness * 0.2,
      maxTokens: DISCUSSION_CONFIG.MAX_TOKENS_DISCUSSION,
    });
  } catch (error) {
    console.warn(`[Collective] ${fullAgent.name} contribution failed:`, error.message);
    content = generateFallbackContribution(fullAgent, currentRound);
  }

  return {
    agentId: fullAgent.id || agent.id,
    agentName: fullAgent.name || agent.name,
    role: fullAgent.role || agent.role,
    content,
    round: currentRound,
  };
}

/**
 * API失敗時のフォールバック
 */
function generateFallbackContribution(agent, round) {
  if (round === 1) {
    const fallbacks = {
      リサーチャー: 'このテーマ、データ面からもう少し整理が必要だと思う。現状の情報だけだと判断しにくいね。',
      ライター: 'テーマとしては面白いけど、もう少し具体的な切り口が欲しいかな。誰に向けた話なのか気になる。',
      マネージャー: 'まずゴールを明確にしよう。何を決めたいのか、期限はいつか。そこから逆算で考えたい。',
    };
    return fallbacks[agent.role] || 'このテーマについてもう少し考えたい。';
  }
  return '皆の意見を聞いて、もう少し整理してから発言したい。';
}

/**
 * 議論レポートを生成する
 * @param {Object} session - 完了した議論セッション
 * @returns {Promise<string>} Markdownレポート
 */
export async function generateReport(session) {
  const allContributions = session.rounds
    .flatMap((r) => r.contributions)
    .map((c) => `【ラウンド${c.round || '?'}】${c.agentName}（${c.role}）:\n${c.content}`)
    .join('\n\n');

  const messages = [
    {
      role: 'user',
      content: `以下の議論をまとめて、Markdown形式のレポートを作成してください。

テーマ: ${session.theme}

--- 議論内容 ---
${allContributions}

--- 出力フォーマット ---
# 議論レポート: ${session.theme}

## 合意点
- （全員が同意した点をリストアップ）

## 相違点
- （意見が分かれた点と、各メンバーの立場を記載）

## 結論・次のステップ
- （議論から導かれる結論と推奨アクション）

簡潔かつ正確にまとめてください。議論で実際に出た意見のみを含め、捏造しないでください。`,
    },
  ];

  const report = await chat(messages, {
    temperature: 0.3,
    maxTokens: DISCUSSION_CONFIG.MAX_TOKENS_REPORT,
  });

  return report;
}
