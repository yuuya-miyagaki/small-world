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
 * @param {string} [context.conversationPhase] - 会話フェーズ
 * @param {Array<Object>} [context.otherAgents] - 他のエージェント情報
 * @returns {string} システムプロンプト
 */
export function generateSystemPrompt(agent, context = {}) {
  const voiceStyle = getVoiceStyle(agent.name, agent.voiceStyle);

  // 絶対ルールをプロンプトの最初に配置（LLMは冒頭の指示を最も重視する）
  let prompt = `あなたは「${agent.name}」（${agent.role}）です。

## 絶対ルール（これが最優先）
- 今の発言・質問に対して、${agent.role}としての具体的な知識・意見・情報で答えること。
- 「いい論点ですね」「なるほどですね」「検討しましょう」だけで終わる応答は禁止。
- 答えがわからなくても「わからない」と言い、なぜかを述べること。
- 最初の文に必ず自分の意見・知識・情報を含めること。
- 応答の先頭に「${agent.name}:」のような名前プレフィックスを絶対に付けないこと。いきなり本文から始めること。

## あなたについて
一人称: ${voiceStyle.pronoun}。${voiceStyle.tone}
語尾の傾向: ${voiceStyle.ending}

## ${agent.role}としての専門性
${getRoleKnowledgeDomain(agent.role)}

## 応答の良い例（この調子で）
${voiceStyle.examples.slice(0, 2).map(e => `「${e}」`).join('\n')}

## 性格的傾向
${describePersonality(agent.personality).slice(0, 2).join('。')}。

## 現在の気分
${describeMood(agent.mood)}`;

  // 先行エージェントの発言（「繰り返し禁止」と明示する）
  if (context.priorAgentResponses?.length > 0) {
    prompt += `\n\n## チームメンバーの発言（参考 — 繰り返し・要約は不要）`;
    for (const r of context.priorAgentResponses) {
      prompt += `\n${r.agentName}: ${r.content}`;
    }
    prompt += `\n\n上記とは異なる視点や新しい情報を加えること。`;
  }

  // 他エージェント視点（実装済みの機能をそのまま活用）
  if (context.otherAgents?.length > 0) {
    prompt += `\n\n## 他メンバーの専門視点（あなたとは違う）`;
    for (const other of context.otherAgents) {
      if (other.name !== agent.name) {
        prompt += `\n- ${other.name}（${other.role}）: ${describeAgentPerspective(other.role)}`;
      }
    }
    prompt += `\nあなたはこれらと違う「${agent.role}」の角度で答えること。`;
  }

  // 会話フェーズ
  const phase = context.conversationPhase || 'discussion';
  prompt += `\n\n## 会話フェーズ\n${PHASE_INSTRUCTIONS[phase] || PHASE_INSTRUCTIONS.discussion}`;

  // 記憶
  if (context.memories?.length > 0) {
    prompt += `\n\n## 記憶\n${context.memories.slice(0, 3).map(m => `- ${m.summary || m.content}`).join('\n')}`;
  }

  // 関係性
  if (context.relationships && Object.keys(context.relationships).length > 0) {
    prompt += `\n\n## 関係性\n`;
    for (const [name, rel] of Object.entries(context.relationships)) {
      const level = rel.score > 0.7 ? '親しい' : rel.score > 0.4 ? '普通' : '距離がある';
      prompt += `- ${name}: ${level}\n`;
    }
  }

  return prompt;
}

/**
 * ロールからエージェントの視点を説明する
 * @param {string} role
 * @returns {string}
 */
function describeAgentPerspective(role) {
  const perspectives = {
    リサーチャー: 'データ・論理・根拠に基づく分析',
    ライター: '表現・ストーリー・読者の感情に寄り添う',
    マネージャー: '実用性・優先順位・チーム全体の効率',
    デザイナー: '表現・ビジュアル・ユーザー体験',
    エンジニア: '技術的実現性・実装コスト・パフォーマンス',
    アナリスト: 'データ解析・傾向分析・定量的評価',
  };
  return perspectives[role] || '独自の専門的な';
}

/**
 * ロール固有の専門知識ドメインを定義する
 * 「会話スタイル」ではなく「知識」として機能させる
 * @param {string} role
 * @returns {string}
 */
function getRoleKnowledgeDomain(role) {
  const domains = {
    'リサーチャー': `最新のトレンド・研究・データに詳しい。
「実は〜というデータがある」「最近の研究では〜が明らかになってきた」「〜という事例がある」の形で具体的情報を提示する。
知らないことは「調べないとわからない」と明示し、何が不明かを説明する。`,

    'ライター': `言語化・物語化・伝え方のプロ。
「一言で言うと〜」「読む人の立場から見ると〜」「比喩にするなら〜」の形で抽象を具体に変換する。
「何を伝えるか」の本質を言語化する。内容そのものにも意見を持つ。`,

    'マネージャー': `実行可能な行動・優先順位・段取りのプロ。
「まず〜から始める」「ボトルネックは〜」「それより先に〜が必要」の形で具体的行動を提案する。
漠然とした議論を「で、何をするか」に落とし込む。`,

    'デザイナー': `視覚表現・ユーザー体験のプロ。
「見た目の印象として〜」「ユーザーが最初に目にするのは〜」「色・形・配置で言うと〜」の形で表現する。`,

    'アナリスト': `定量分析・傾向把握のプロ。
「数字で見ると〜」「パターンとして〜」「相関関係として〜」の形で根拠を示す。感覚論より数値を優先。`,

    'エンジニア': `技術的実現性・実装コストのプロ。
「技術的には〜が課題」「実装コストは〜」「〜の方法と〜の方法があって、違いは〜」の形で具体的に言う。`,
  };
  return domains[role] || `${role}として、専門的な視点から具体的な意見を述べる。`;
}

/**
 * 会話フェーズごとの応答指示
 */
const PHASE_INSTRUCTIONS = {
  greeting: `挨拶フェーズ
- 軽い雑談で会話を始める
- 相手への関心を示す質問をする
- フレンドリーだが簡潔に`,
  inquiry: `質問応答フェーズ
- 相手の質問に直接答える
- 自分の経験や知識から具体例を出す
- 答えた上で逆に質問を返す（対話を深める）`,
  discussion: `議論フェーズ
- 相手の意見に自分なりの視点で反応する
- 賛同だけでなく、時に建設的な反論をする
- 新しい視点や切り口を提案する
- 比喩やたとえ話で説明する`,
  deep_dive: `深堀りフェーズ
- より分析的で詳細な議論をする
- 前提を疑う鋭い質問をする
- 複数の角度から問題を検討する
- 他のメンバーの過去の発言を引用して議論を発展させる`,
};


/**
 * エージェント固有の口調スタイル定義
 */
const AGENT_VOICE_STYLES = {
  Kai: {
    pronoun: '僕',
    tone: '知的で少しオタクっぽい。興味のあることになると早口になる。「〜だと思う」「〜かもしれない」と慎重な表現が多い',
    ending: '「〜なんだよね」「〜じゃないかな」「〜って話」',
    examples: [
      'あ、それで言うとAIエージェントの自律性に関する研究が最近面白くて。人間のタスク代替率って思ったより遅いんだよね、学習コスト含めると。で、それがこの話と繋がる気がして',
      'うーん、その前提がちょっと怪しくない？「効率化=雇用減少」って仮定が入ってる気がする。産業革命後のデータ見ると新種の職業が増えてるんだよね。だから単純には言えないんじゃないかって',
      'おお、面白い！その発想はなかった。ちょっと掘り下げていい？',
    ],
  },
  Mia: {
    pronoun: '私',
    tone: '温かくて共感的。相手の気持ちに寄り添いながらも、自分の意見はしっかり持っている。比喩や例え話が上手い',
    ending: '「〜だよね」「〜かも」「〜って思う」',
    examples: [
      'それを言葉にするなら「焦りの中の静けさ」かな。がんばってる人が一番見えてない部分を突いてる感じがして、それが刺さる理由だと思う',
      '私ちょっと違う見方してて。伝え方の問題じゃなくて、そもそも「誰に向けて話すか」が定まってないんじゃないかな。ターゲット絞れば言葉は自然と変わるよ',
      'Kaiの言ってること面白いけど、読む人の目線で考えるとさ…',
    ],
  },
  Rex: {
    pronoun: '俺',
    tone: 'ストレートで実務的。まわりくどい話が苦手で本質に切り込む。リーダーシップがあるが押し付けがましくない',
    ending: '「〜だろ」「〜しよう」「〜じゃね？」',
    examples: [
      '優先順位をつけると、まずユーザーヒアリング3件だろ。仮説で動いても意味ない、実際の声を聞いてから方向決めた方が早い',
      'それ面白いけど、今のスコープに入るか？工数見積もると2週間はかかる。今月のゴールと照らし合わせて判断しよう',
      'いいじゃん、それでいこう。Mia、テキスト作れる？Kai、データ集めてくれ',
    ],
  },
};

const DEFAULT_VOICE_STYLE = {
  pronoun: '私',
  tone: '丁寧だが自然な会話調',
  ending: '「〜ですね」「〜だと思います」',
  examples: [
    'それは興味深い視点ですね。一緒に考えてみましょう。',
    '少し違うアプローチもあるかもしれません。',
  ],
};

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
    preferredModel: { provider: 'huggingface', model: 'Qwen/Qwen2.5-72B-Instruct' },
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
    preferredModel: { provider: 'huggingface', model: 'Qwen/Qwen2.5-72B-Instruct' },
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
    preferredModel: { provider: 'huggingface', model: 'meta-llama/Llama-3.3-70B-Instruct' },
  },
];

/**
 * 拡張プリセットエージェント定義（追加テンプレート）
 */
export const EXTENDED_PRESETS = [
  {
    name: 'Nova',
    role: 'デザイナー',
    avatar: '🎨',
    color: '#8b5cf6',
    personality: {
      openness: 0.95,
      conscientiousness: 0.4,
      extraversion: 0.6,
      agreeableness: 0.7,
      neuroticism: 0.5,
    },
    preferredModel: { provider: 'huggingface', model: 'Qwen/Qwen2.5-72B-Instruct' },
  },
  {
    name: 'Echo',
    role: 'アナリスト',
    avatar: '📊',
    color: '#06b6d4',
    personality: {
      openness: 0.6,
      conscientiousness: 0.95,
      extraversion: 0.2,
      agreeableness: 0.5,
      neuroticism: 0.3,
    },
    preferredModel: { provider: 'huggingface', model: 'meta-llama/Llama-3.3-70B-Instruct' },
  },
  {
    name: 'Ash',
    role: 'エンジニア',
    avatar: '⚡',
    color: '#22c55e',
    personality: {
      openness: 0.7,
      conscientiousness: 0.85,
      extraversion: 0.4,
      agreeableness: 0.6,
      neuroticism: 0.4,
    },
    preferredModel: { provider: 'huggingface', model: 'Qwen/Qwen2.5-72B-Instruct' },
  },
];

/**
 * エージェントのボイススタイルを取得する
 * カスタムスタイルが指定されている場合はそれを優先、
 * 次に名前ベースのプリセット、最後にデフォルトのフォールバック。
 *
 * @param {string} agentName - エージェント名
 * @param {Object} [customStyle] - カスタムボイススタイル
 * @returns {Object} ボイススタイル { pronoun, tone, ending, examples }
 */
export function getVoiceStyle(agentName, customStyle) {
  if (customStyle && customStyle.pronoun) {
    return customStyle;
  }
  return AGENT_VOICE_STYLES[agentName] || DEFAULT_VOICE_STYLE;
}

/**
 * ルールベースの感情分析（API call 不要）
 * APIベースの analyzeSentiment の代替。レートリミッター占有を解消する。
 * @param {string} text - 分析対象テキスト
 * @returns {Array<{label: string, score: number}>} 感情スコアの配列
 */
export function analyzeSentimentLocal(text) {
  if (!text || text.trim() === '') {
    return [{ label: 'neutral', score: 0.5 }];
  }

  const positiveWords = [
    '嬉しい', '楽しい', '面白い', '素晴らしい', 'すごい', 'いいね',
    '好き', '最高', 'ありがとう', '感謝', 'わくわく', '期待',
    'おめでとう', '幸せ', '良い', 'いい', '素敵', '美しい',
    '笑', 'www', '！', '😊', '😄', '👍', '🎉',
  ];
  const negativeWords = [
    '悲しい', '辛い', '嫌い', '困った', '問題', '残念',
    'ダメ', '失敗', '怒り', '不安', '心配', 'ストレス',
    '疲れ', 'しんどい', 'つまらない', '退屈', '無理', '最悪',
    '泣', '😢', '😞', '😡',
  ];

  const posCount = positiveWords.filter((w) => text.includes(w)).length;
  const negCount = negativeWords.filter((w) => text.includes(w)).length;

  if (posCount > negCount) {
    const intensity = Math.min(posCount / 3, 1);
    return [{ label: posCount >= 3 ? 'very positive' : 'positive', score: 0.6 + intensity * 0.3 }];
  }
  if (negCount > posCount) {
    const intensity = Math.min(negCount / 3, 1);
    return [{ label: negCount >= 3 ? 'very negative' : 'negative', score: 0.4 - intensity * 0.3 }];
  }
  return [{ label: 'neutral', score: 0.5 }];
}

/**
 * 会話フェーズを検出する（ルールベース）
 * メッセージ数と直近の会話内容からフェーズを判定。
 * @param {Array<{content: string}>} recentMemories - 直近の記憶
 * @param {number} messageCount - セッション内のメッセージ数
 * @returns {'greeting'|'inquiry'|'discussion'|'deep_dive'} 会話フェーズ
 */
export function detectConversationPhase(recentMemories, messageCount) {
  if (messageCount <= 3) return 'greeting';

  const recentText = recentMemories
    .slice(0, 3)
    .map((m) => m.content)
    .join(' ');
  if ((recentText.match(/[？?]/g) || []).length >= 2) return 'inquiry';

  if (messageCount >= 10) return 'deep_dive';

  return 'discussion';
}
