/**
 * Pipeline — タスクパイプライン (Phase 2b: Atelier)
 *
 * ユーザーがタスクを投げる → 3体のエージェントが分業で成果物を制作
 *
 * フロー:
 *   1. Kai（リサーチャー）→ 調査・情報収集
 *   2. Mia（ライター）  → 執筆・制作
 *   3. Rex（マネージャー）→ レビュー・最終化
 *
 * 各ステージの出力が次のステージの入力になる（シリアル実行）
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
import { listAgents } from './agent.js';
import { stopHeartbeatLoop } from './autonomy.js';

/**
 * パイプラインステージ定義
 */
export const PIPELINE_STAGES = [
  {
    id: 'research',
    name: '調査',
    role: 'リサーチャー',
    emoji: '🔬',
    instruction: (task) =>
      `以下のタスクに必要な情報を調査・整理してください。\n\nタスク: ${task}\n\n調査結果を箇条書きで簡潔にまとめてください。事実と根拠に基づいた情報のみ含めてください。`,
    withPrevious: null,
  },
  {
    id: 'write',
    name: '執筆',
    role: 'ライター',
    emoji: '✍️',
    instruction: (task, prevOutput) =>
      `以下の調査結果に基づいて、タスクを実行してください。\n\nタスク: ${task}\n\n--- 調査結果（リサーチャーから） ---\n${prevOutput}\n\n上記の調査を踏まえて、成果物を作成してください。あなたらしい文体で、読みやすく仕上げてください。`,
    withPrevious: 'research',
  },
  {
    id: 'review',
    name: 'レビュー',
    role: 'マネージャー',
    emoji: '👔',
    instruction: (task, prevOutput) =>
      `以下の成果物をレビューし、最終版を出力してください。\n\nタスク: ${task}\n\n--- 成果物（ライターから） ---\n${prevOutput}\n\n改善点があれば修正し、最終版を出力してください。品質・完成度・実行可能性の観点でチェックしてください。`,
    withPrevious: 'write',
  },
];

/**
 * タスクパイプラインを実行
 * @param {string} worldId
 * @param {string} task - タスク内容
 * @param {Object} [options] - { onProgress: Function }
 * @returns {Promise<Object>} パイプライン結果
 */
export async function runPipeline(worldId, task, options = {}) {
  const { onProgress } = options;
  const agents = await listAgents(worldId);

  if (agents.length === 0) {
    throw new Error('パイプラインを実行するエージェントがいません');
  }

  // ハートビート停止
  for (const agent of agents) {
    stopHeartbeatLoop(agent.id);
  }

  // パイプライン初期化
  const pipeline = {
    id: null,
    worldId,
    task,
    stages: [],
    deliverable: null,
    status: 'in_progress',
    createdAt: new Date().toISOString(),
  };

  // Firestoreに保存
  try {
    const db = getFirebaseDb();
    const ref = doc(collection(db, `worlds/${worldId}/pipelines`));
    pipeline.id = ref.id;
    await setDoc(ref, { ...pipeline, createdAt: serverTimestamp() });
  } catch {
    pipeline.id = `local-${Date.now()}`;
  }

  // ステージ順次実行
  let previousOutput = null;

  for (const stage of PIPELINE_STAGES) {
    // ロールに対応するエージェントを検索
    const agent = agents.find((a) => a.role === stage.role) || agents[0];

    if (onProgress) {
      onProgress({
        stage: stage.id,
        stageName: stage.name,
        agentName: agent.name,
        step: PIPELINE_STAGES.indexOf(stage) + 1,
        total: PIPELINE_STAGES.length,
      });
    }

    const stageResult = await executeStage(agent, task, stage, previousOutput);
    pipeline.stages.push(stageResult);
    previousOutput = stageResult.content;
  }

  // 最終成果物 = 最後のステージの出力
  pipeline.deliverable = previousOutput;
  pipeline.status = 'completed';

  // Firestoreに完了状態を保存
  try {
    const db = getFirebaseDb();
    const ref = doc(db, `worlds/${worldId}/pipelines`, pipeline.id);
    await setDoc(ref, { ...pipeline, completedAt: serverTimestamp() }, { merge: true });
  } catch {
    // 保存失敗は無視
  }

  return pipeline;
}

/**
 * 1つのステージを実行
 */
async function executeStage(agent, task, stage, previousOutput) {
  const basePrompt = generateSystemPrompt(agent);

  // プロンプト構築
  const userContent = previousOutput
    ? stage.instruction(task, previousOutput)
    : stage.instruction(task);

  const messages = [
    { role: 'system', content: `${basePrompt}\n\n【パイプラインモード】あなたは今、チームの一員としてタスクを分担しています。あなたの担当は「${stage.name}」です。` },
    { role: 'user', content: userContent },
  ];

  let content;
  let isFallback = false;

  try {
    content = await chat(messages, {
      temperature: 0.6,
      maxTokens: 1024,
    });
  } catch (error) {
    console.warn(`[Pipeline] ${agent.name} (${stage.name}) failed:`, error.message);
    content = generateStageFallback(stage, previousOutput);
    isFallback = true;
  }

  return {
    stageId: stage.id,
    stageName: stage.name,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    emoji: stage.emoji,
    content,
    isFallback,
  };
}

/**
 * ステージ失敗時のフォールバック
 */
function generateStageFallback(stage, previousOutput) {
  const fallbacks = {
    research: 'このテーマについて、一般的な情報をもとに進めます。追加の調査が必要かもしれません。',
    write: previousOutput
      ? `調査結果に基づいて作成を試みましたが、技術的な問題で完全な成果物を生成できませんでした。調査内容は以下のとおりです:\n${previousOutput}`
      : 'タスクの実行中に問題が発生しました。再試行してください。',
    review: previousOutput
      ? `レビュー中に問題が発生しました。以下の成果物をそのまま出力します:\n${previousOutput}`
      : '成果物のレビューができませんでした。',
  };
  return fallbacks[stage.id] || 'ステージの実行に失敗しました。';
}
