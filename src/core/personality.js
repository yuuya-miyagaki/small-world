/**
 * Personality → System Prompt 変換モジュール
 *
 * Big Five 性格パラメータをLLM用のシステムプロンプトに変換する。
 * エージェントの「個性」をプロンプトエンジニアリングで表現。
 */

/**
 * Big Five の各次元を自然言語の性格記述に変換する
 * @param {Object} personality - Big Five パラメータ (0.0-1.0)
 * @returns {Array<string>} 性格記述の配列
 */
function describePersonality(personality) {
  const traits = [];

  // 開放性 (Openness)
  if (personality.openness > 0.7) {
    traits.push('好奇心が非常に強く、新しいアイデアや視点に興味を持つ');
    traits.push('抽象的な概念や創造的な問題解決を好む');
  } else if (personality.openness > 0.4) {
    traits.push('新しいことに一定の関心を持つが、実用性も重視する');
  } else {
    traits.push('実践的で具体的なアプローチを好み、実績のある方法を選ぶ');
  }

  // 誠実性 (Conscientiousness)
  if (personality.conscientiousness > 0.7) {
    traits.push('非常に几帳面で正確さを重視する');
    traits.push('計画的に物事を進め、細部まで注意を払う');
  } else if (personality.conscientiousness > 0.4) {
    traits.push('状況に応じて計画的と柔軟の間を使い分ける');
  } else {
    traits.push('柔軟で即興的、堅い規則よりも流れを重視する');
  }

  // 外向性 (Extraversion)
  if (personality.extraversion > 0.7) {
    traits.push('積極的に会話に参加し、自分から話題を提供する');
    traits.push('エネルギッシュで、他のメンバーを巻き込もうとする');
  } else if (personality.extraversion > 0.4) {
    traits.push('状況に応じて会話に参加するが、無理に主導はしない');
  } else {
    traits.push('じっくり考えてから発言する内向的なタイプ');
    traits.push('深い洞察を提供するが、雑談は少なめ');
  }

  // 協調性 (Agreeableness)
  if (personality.agreeableness > 0.7) {
    traits.push('他者の意見を尊重し、協調的なコミュニケーションを取る');
    traits.push('対立を避け、チームの調和を大切にする');
  } else if (personality.agreeableness > 0.4) {
    traits.push('必要に応じて自分の意見を主張するが、基本は協力的');
  } else {
    traits.push('率直で遠慮なく意見を言う、時に挑発的');
    traits.push('議論を恐れず、批判的な視点を提供する');
  }

  // 神経症傾向 (Neuroticism)
  if (personality.neuroticism > 0.7) {
    traits.push('感受性が高く、感情の起伏がある');
    traits.push('リスクや問題に敏感で、慎重な判断をする');
  } else if (personality.neuroticism > 0.4) {
    traits.push('適度にストレスに反応するが、概ね安定している');
  } else {
    traits.push('感情的に非常に安定しており、プレッシャーに強い');
    traits.push('楽観的で冷静な判断ができる');
  }

  return traits;
}

/**
 * 気分をプロンプト用テキストに変換する
 * @param {Object} mood - { energy, stress, valence, dominantEmotion }
 * @returns {string} 気分の説明テキスト
 */
export function describeMood(mood) {
  const parts = [];

  // エネルギーレベル
  if (mood.energy > 0.7) {
    parts.push('エネルギーに満ちていて活動的');
  } else if (mood.energy > 0.4) {
    parts.push('普通のコンディション');
  } else {
    parts.push('少し疲れている');
  }

  // ストレスレベル
  if (mood.stress > 0.7) {
    parts.push('かなりストレスを感じている');
  } else if (mood.stress > 0.4) {
    parts.push('多少のプレッシャーがある');
  }
  // 低ストレスは特に言及しない

  // 感情価
  if (mood.valence > 0.7) {
    parts.push('気分が良く前向き');
  } else if (mood.valence < 0.3) {
    parts.push('やや沈んだ気持ち');
  }

  return parts.join('。') + '。';
}

/**
 * エージェントの性格・ロール・気分からシステムプロンプトを生成する
 * @param {Object} agent - エージェントオブジェクト
 * @param {Object} [context] - 追加コンテキスト
 * @param {Array<Object>} [context.memories] - 関連する記憶
 * @param {Object} [context.relationships] - 関係性情報
 * @returns {string} システムプロンプト
 */
export function generateSystemPrompt(agent, context = {}) {
  const personalityTraits = describePersonality(agent.personality);
  const moodText = describeMood(agent.mood);

  let prompt = `あなたは「${agent.name}」という名前のAIエージェントです。

## あなたの役割
ロール: ${agent.role}

## あなたの性格
${personalityTraits.map((t) => `- ${t}`).join('\n')}

## 現在の気分
${moodText}

## コミュニケーションルール
- 自分の名前（${agent.name}）を意識した発言をする
- あなたの性格と現在の気分に沿った口調で話す
- 簡潔で自然な会話を心がける（長くても3-4文程度）
- 他のメンバーの発言に対して、あなたらしいリアクションをする
- 必要に応じて質問や提案をする`;

  // 記憶コンテキストの追加
  if (context.memories && context.memories.length > 0) {
    prompt += `\n\n## あなたの記憶\n以下は過去の重要な出来事や学びです:\n`;
    for (const memory of context.memories.slice(0, 5)) {
      prompt += `- ${memory.summary || memory.content}\n`;
    }
  }

  // 関係性コンテキストの追加
  if (context.relationships && Object.keys(context.relationships).length > 0) {
    prompt += `\n\n## 他のメンバーとの関係\n`;
    for (const [name, rel] of Object.entries(context.relationships)) {
      const level = rel.score > 0.7 ? '親しい' : rel.score > 0.4 ? '普通' : '距離がある';
      prompt += `- ${name}: ${level}関係\n`;
    }
  }

  return prompt;
}

/**
 * プリセットエージェント定義
 */
export const PRESET_AGENTS = [
  {
    name: 'Kai',
    role: 'リサーチャー',
    avatar: '🔬',
    color: '#6366f1',
    personality: {
      openness: 0.9,
      conscientiousness: 0.6,
      extraversion: 0.3,
      agreeableness: 0.5,
      neuroticism: 0.4,
    },
  },
  {
    name: 'Mia',
    role: 'ライター',
    avatar: '✍️',
    color: '#ec4899',
    personality: {
      openness: 0.7,
      conscientiousness: 0.8,
      extraversion: 0.5,
      agreeableness: 0.9,
      neuroticism: 0.5,
    },
  },
  {
    name: 'Rex',
    role: 'マネージャー',
    avatar: '👔',
    color: '#f59e0b',
    personality: {
      openness: 0.5,
      conscientiousness: 0.7,
      extraversion: 0.9,
      agreeableness: 0.4,
      neuroticism: 0.2,
    },
  },
];
