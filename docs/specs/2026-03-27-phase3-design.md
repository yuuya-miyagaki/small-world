# Phase 3 設計: カスタムエージェント + 技術的負債解消

**日付**: 2026-03-27
**ステータス**: ドラフト（レビュー待ち）

---

## 1. 概要

Phase 2（Synapse/Atelier/Collective）の完了を受け、Phase 3 では以下の2軸で開発を行う:

1. **カスタムエージェント作成 UI** — ユーザーが自由にエージェントを定義・追加できる機能
2. **技術的負債解消** — CSS分割、エラーハンドリング統一、バンドルサイズ最適化

---

## 2. スコープ

### 2.1 カスタムエージェント作成 UI

| # | 機能 | 詳細 |
|---|------|------|
| 1 | エージェント作成モーダル | 名前・アバター・ロール・カラー入力フォーム |
| 2 | Big Five スライダー | 5つの性格パラメータを視覚的に調整 |
| 3 | プリセットテンプレート | リサーチャー/ライター/マネージャー + 新規追加テンプレート |
| 4 | カスタムボイススタイル | 口調・一人称・語尾のカスタマイズ |
| 5 | エージェント削除 | 確認ダイアログ付き削除機能 |
| 6 | ワールド作成時のエージェント選択 | デフォルト3体 or カスタム選択 |

### 2.2 技術的負債解消

| # | 項目 | 詳細 |
|---|------|------|
| 1 | CSS コンポーネント分割 | dashboard.css (884行) → 5ファイルに分割 |
| 2 | エラーハンドリング統一 | AppError クラス + 統一パターン |
| 3 | バンドルサイズ最適化 | 動的 import() でコード分割 (666KB → 目標300KB以下) |

### スコープ外（Phase 3 ではやらない）

- Cloud Functions 移行（Phase 4 で対応）
- 自動 E2E テスト（Playwright）導入
- エージェント間の「チーム」概念
- エージェント画像アバターのアップロード

---

## 3. アーキテクチャ

### 3.1 エージェント作成フロー

```
ユーザー操作                        コード層
──────────                        ────────
[➕ ボタン]                       dashboard.js
  │
  ├── [プリセット選択]             agentCreator.js (新規)
  │     └── テンプレートロード     personality.js (PRESET_AGENTS + 追加テンプレート)
  │
  └── [カスタム作成]               agentCreator.js (新規)
        ├── 名前入力
        ├── アバター選択 (絵文字ピッカー)
        ├── ロール入力
        ├── Big Five スライダー
        ├── ボイススタイル設定
        └── [作成]                 agent.js (createAgent)
              │
              ├── Firestore 保存
              ├── メッセージバスに参加
              └── ダッシュボードリロード
```

### 3.2 新規ファイル

```
src/
├── ui/
│   └── components/
│       └── agentCreator.js     # エージェント作成モーダル (新規)
├── styles/
│   ├── dashboard.css           # レイアウト + ヘッダーのみ (リファクタ)
│   ├── sidebar.css             # サイドバー (分割)
│   ├── chat.css                # チャットパネル (分割)
│   ├── detail.css              # 詳細パネル (分割)
│   ├── modal.css               # モーダル共通 (分割)
│   └── agent-creator.css       # エージェント作成 (新規)
└── core/
    └── errors.js               # 統一エラーハンドリング (新規)
```

### 3.3 既存ファイルの変更

| ファイル | 変更内容 |
|----------|----------|
| `personality.js` | `PRESET_AGENTS` に新テンプレート追加, `AGENT_VOICE_STYLES` をエクスポート |
| `dashboard.js` | エージェント追加ボタンの UI + イベントハンドラ |
| `worldService.js` | カスタムエージェント付きワールド作成対応 |
| `agent.js` | `deleteAgent()` 関数追加 |
| `messageBus.js` | 動的エージェント追加のハンドリング |

---

## 4. データモデル

### 4.1 エージェントドキュメント（既存 + 拡張）

```javascript
// Firestore: worlds/{worldId}/agents/{agentId}
{
  id: "agent_abc123",
  name: "Luna",                    // ユーザー指定
  role: "デザイナー",               // ユーザー指定 (フリーテキスト)
  avatar: "🎨",                    // ユーザー指定 (絵文字)
  color: "#8b5cf6",                // ユーザー指定 (カラーピッカー)
  isPreset: false,                 // ← 追加: プリセットか否か
  personality: {
    openness: 0.8,
    conscientiousness: 0.6,
    extraversion: 0.7,
    agreeableness: 0.8,
    neuroticism: 0.3,
  },
  voiceStyle: {                    // ← 追加: カスタムボイス
    pronoun: "あたし",
    tone: "明るくてポップ。絵文字を使いがち",
    ending: "「〜だよ！」「〜じゃない？」",
  },
  mood: { ... },                   // 既存のまま
  status: "idle",                  // 既存のまま
  relationships: {},               // 既存のまま
  stats: { ... },                  // 既存のまま
  createdAt: Timestamp,
}
```

**重要**: `isPreset` フィールドの追加は **後方互換** — 既存エージェントに `isPreset` がなければ `true` として扱う。

### 4.2 追加プリセットテンプレート

```javascript
// personality.js に追加するテンプレート
{
  name: 'Nova',
  role: 'デザイナー',
  avatar: '🎨',
  color: '#8b5cf6',
  personality: {
    openness: 0.95, conscientiousness: 0.4,
    extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.5,
  },
},
{
  name: 'Echo',
  role: 'アナリスト',
  avatar: '📊',
  color: '#06b6d4',
  personality: {
    openness: 0.6, conscientiousness: 0.95,
    extraversion: 0.2, agreeableness: 0.5, neuroticism: 0.3,
  },
},
{
  name: 'Ash',
  role: 'エンジニア',
  avatar: '⚡',
  color: '#22c55e',
  personality: {
    openness: 0.7, conscientiousness: 0.85,
    extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.4,
  },
},
```

---

## 5. UI 設計

### 5.1 エージェント作成モーダル

```
┌──────────────────────────────────────────┐
│  🤖 エージェントを作成                      │
│                                          │
│  ─── プリセットテンプレート ───             │
│  [🔬Kai風] [✍️Mia風] [👔Rex風]            │
│  [🎨Nova] [📊Echo] [⚡Ash]               │
│  [⬜ ゼロから作成]                         │
│                                          │
│  名前:     [_______________]              │
│  ロール:   [_______________]              │
│  アバター: [😀] ← クリックで絵文字選択     │
│  カラー:   [■] ← カラーピッカー           │
│                                          │
│  ─── 性格 (Big Five) ───                  │
│  開放性     ●━━━━━━━━━━○  0.8            │
│  誠実性     ●━━━━━━○━━━━  0.6            │
│  外向性     ●━━━━━━━━○━━  0.7            │
│  協調性     ●━━━━━━━━━━○  0.8            │
│  神経症     ●━━━○━━━━━━━  0.3            │
│                                          │
│  ─── 口調 (任意) ───                      │
│  一人称:   [あたし___]                     │
│  話し方:   [明るくてポップ__]              │
│  語尾:     [〜だよ！______]               │
│                                          │
│         [キャンセル]  [✨ 作成]            │
└──────────────────────────────────────────┘
```

### 5.2 サイドバーのエージェント追加ボタン

```
エージェント
┌────────────────┐
│ 🔬 Kai         │  ← 既存
│    リサーチャー  │
├────────────────┤
│ ✍️ Mia         │  ← 既存
│    ライター     │
├────────────────┤
│ 👔 Rex         │  ← 既存
│    マネージャー  │
├────────────────┤
│  ➕ 追加        │  ← 新規ボタン
└────────────────┘
```

---

## 6. CSS コンポーネント分割計画

### 現状

```
dashboard.css (884行) — 全スタイルが1ファイル
```

### 分割後

```
styles/
├── dashboard.css       → レイアウト + ヘッダー (~80行)
├── sidebar.css         → サイドバー + エージェント一覧 (~130行)
├── chat.css            → チャットパネル + メッセージ (~200行)
├── detail.css          → 詳細パネル + Big Five バー (~150行)
├── modal.css           → モーダル共通 + 議論/パイプライン (~200行)
└── agent-creator.css   → エージェント作成特有 (~120行, 新規)
```

### import 戦略

```css
/* index.css に追加 */
@import './sidebar.css';
@import './chat.css';
@import './detail.css';
@import './modal.css';
@import './agent-creator.css';
```

Vite が CSS を自動バンドルするため、パフォーマンスへの影響なし。

---

## 7. エラーハンドリング統一

### 現状の問題

| モジュール | 現在のパターン | 問題 |
|-----------|-------------|------|
| collective.js | `catch → console.error` | UIにエラーが伝搬しない |
| pipeline.js | `catch → フォールバック応答生成` | エラーが隠蔽される |
| synapse.js | `catch → 空配列 return` | サイレント失敗 |

### 統一パターン

```javascript
// src/core/errors.js (新規)
export class AppError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;      // 'API_LIMIT', 'NETWORK', 'AUTH', 'FIRESTORE'
    this.cause = cause;
  }
}

// 使用例
try {
  await callGeminiApi(prompt);
} catch (err) {
  if (err.status === 429) {
    throw new AppError('API_LIMIT', 'APIレート制限に達しました', err);
  }
  throw new AppError('NETWORK', 'API接続エラー', err);
}
```

UI レイヤーで `AppError.code` に応じたトースト通知を表示。

---

## 8. テスト方針

| テスト種別 | 対象 | 件数目安 |
|-----------|------|---------|
| Unit | agentCreator.js（テンプレート適用、バリデーション）| 8-10件 |
| Unit | errors.js（エラー分類、コード設定）| 4-5件 |
| Unit | agent.js deleteAgent() | 3件 |
| Unit | personality.js 新テンプレート | 3件 |
| Integration | ワールド作成 + カスタムエージェント | 2-3件 |

**テスト比率目標**: 45% 維持（現在 45.3%）

---

## 9. 実装順序（推奨）

```
Step 1: CSS 分割 (リファクタ — テスト不要、視覚検証)
Step 2: errors.js (統一エラー — unit test)
Step 3: personality.js 拡張 (新テンプレート + voiceStyle エクスポート — unit test)
Step 4: agent.js 拡張 (deleteAgent + voiceStyle対応 — unit test)
Step 5: agentCreator.js UI (作成モーダル + ダッシュボード統合 — unit test)
Step 6: バンドルサイズ最適化 (動的 import — ビルド検証)
Step 7: E2E ブラウザ検証 + デプロイ
```

---

## 10. リスクと軽減策

| リスク | 影響 | 軽減策 |
|--------|------|--------|
| CSS分割でスタイル崩れ | UI壊れ | 分割前後でスクリーンショット比較 |
| personality.js の voiceStyle が既存エージェントにない | エラー | DEFAULT_VOICE_STYLE フォールバック（既存） |
| エージェント数増加でハートビート API 負荷増 | 429エラー | エージェント上限 6体、ハートビート間隔調整 |
| Firestore の既存データとの互換性 | データ不整合 | isPreset のデフォルト true、voiceStyle はオプショナル |
