# Phase 4 設計文書: AI応答品質改善（CROSS-AI レビュー反映済み）

**日付**: 2026-03-28
**ステータス**: レビュー反映済み — 実装計画待ち
**セカンドオピニオン**: Claude Code（2026-03-28 01:07）

---

## 課題

| # | 課題 | 根本原因 |
|---|------|---------|
| 1 | 応答速度が遅い | 記憶検索3回直列 + 感情分析がメインキューを占有（**P1**） |
| 2 | 応答バラエティ不足 | プロンプトが静的、会話フェーズに応じた変化なし |
| 3 | 多角的調査感なし | 他エージェント視点未参照、外部知識参照なし |

---

## CROSS-AI レビューによる設計修正

### ❌ 設計から除外したもの

| 当初案 | 除外理由（Claude Code指摘） |
|--------|---------------------------|
| Google Search Grounding | キャラクター性と衝突。検索クエリ制御不能。日本語品質低下 |
| レートリミッター緩和 | ボトルネックではない（API応答自体が2-5秒） |
| RAG/ベクトルDB | Phase 4 スコープ外（Phase 5 以降で検討） |
| 会話フェーズ LLM 判定 | 3エージェント×追加API call = 合計8秒待ち。ルールベースで十分 |

### 🆕 追加で発見された問題

| 深刻度 | 問題 | 対策 |
|--------|------|------|
| **P1** | `analyzeSentiment` がメイン応答キューを占有 → 3エージェント応答が最低5秒 | 感情分析をルールベース化 or 別キュー |
| **P1** | ストリーミング応答と Firestore onSnapshot が設計衝突 | 仮メッセージ制御フロー設計が必須 |
| **P2** | `consolidateMemories` のハートビートとの競合 | ロック or タイムスタンプガード |
| **P3** | `recallMemories` が全件フェッチ → O(n) スキャン | Firestore クエリ最適化 |
| **P3** | temperature 値域設計不在 | min/max クリッピング定義 |

---

## 確定タスク（実装優先順位）

### Task 1: 記憶検索の並列化
**変更規模**: messageBus.js 4行変更
**効果**: 1-3秒短縮

```javascript
// Before（直列）
const longTermMemories = await recallMemories(...);
const episodes = await recallRelevantEpisodes(...);
const recentMemories = await getRecentMemories(...);

// After（並列）
const [longTermMemories, episodes, recentMemories] = await Promise.all([
  recallMemories(...),
  recallRelevantEpisodes(...).catch(() => []),
  getRecentMemories(...),
]);
```

### Task 2: 感情分析のキュー占有解消
**変更規模**: aiService.js + messageBus.js
**効果**: 3エージェント応答の詰まり完全解消

方針: `analyzeSentiment` をルールベースに変更（API call 不要）

```javascript
function analyzeSentimentLocal(text) {
  const positiveWords = ['嬉しい', '面白い', '素晴らしい', 'いいね', '好き', '楽しい'];
  const negativeWords = ['悲しい', '辛い', '嫌い', '困った', '問題', '残念'];
  const posCount = positiveWords.filter(w => text.includes(w)).length;
  const negCount = negativeWords.filter(w => text.includes(w)).length;
  if (posCount > negCount) return [{ label: 'positive', score: 0.7 }];
  if (negCount > posCount) return [{ label: 'negative', score: 0.3 }];
  return [{ label: 'neutral', score: 0.5 }];
}
```

### Task 3: 他エージェント視点参照（プロンプト改善）
**変更規模**: personality.js 数行追加
**効果**: 追加API callゼロで対話の多角性改善

```
## 他のメンバーの視点を意識して
- Miaは感情・表現の観点から見ている
- Rexは実用性・優先順位の観点から見ている
- Kaiはデータ・論理の観点から見ている
あなたの専門の視点から、彼らとは異なる角度で意見を言うこと
```

### Task 4: 会話フェーズ検出（ルールベース）+ プロンプト切替
**変更規模**: personality.js 新関数1本 + プロンプト分岐
**効果**: 応答バラエティ改善

```javascript
function detectPhase(recentMemories, messageCount) {
  if (messageCount <= 3) return 'greeting';
  const recentText = recentMemories.slice(0,3).map(m => m.content).join(' ');
  if ((recentText.match(/[？?]/g) || []).length >= 2) return 'inquiry';
  if (messageCount >= 10) return 'deep_dive';
  return 'discussion';
}
```

### Task 5: ストリーミング応答（設計先行）
**変更規模**: アーキテクチャ設計 + aiService.js + messageBus.js + dashboard.js
**効果**: UX大改善

**制御フロー（P1 設計衝突の解決策）**:
1. DOM に `data-streaming="true"` 付き仮メッセージ要素を挿入
2. Gemini StreamGenerateContent でチャンク受信ごとに仮要素のテキストを更新
3. Stream 完了後、`sendMessage()` で Firestore に書き込み（仮メッセージの ID を付与）
4. `onSnapshot` 発火時、同一 ID の仮要素があれば **置換**（追加ではなく）
5. 仮要素の `data-streaming` 属性を削除

---

## テスト方針

| Task | テスト方法 |
|------|-----------|
| 1 | ユニットテスト: 並列結果の整合性 |
| 2 | ユニットテスト: ルールベース感情分析の精度 |
| 3 | E2E: プロンプト変更後の応答多様性確認 |
| 4 | ユニットテスト: フェーズ検出の正確性 |
| 5 | E2E: ストリーミング表示・二重表示防止の確認 |
