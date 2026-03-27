# Phase 3a 設計: 技術的負債解消

**日付**: 2026-03-27
**ステータス**: ✅ 完了（Sprint 1 で実装済み）

---

## 1. 概要

Phase 2（Synapse/Atelier/Collective）完了後の技術的負債を解消する。

---

## 2. スコープ

| # | 項目 | 詳細 | ステータス |
| --- | ------ | ------ | ----------- |
| 1 | CSS コンポーネント分割 | dashboard.css (884行) → 6ファイルに分割 | ✅ 完了 |
| 2 | エラーハンドリング統一 | AppError クラス + classifyError + ERROR_CODES | ✅ 完了 |
| 3 | バンドルサイズ最適化 | 動的 import() でコード分割 (666KB → 目標300KB以下) | 🔲 Task 7 で対応 |

---

## 3. CSS コンポーネント分割（完了）

### 分割前

```text
dashboard.css (884行) — 全スタイルが1ファイル
```

### 分割後

```text
styles/
├── dashboard.css       → レイアウト + ヘッダー (60行)
├── sidebar.css         → サイドバー + エージェント一覧 (135行)
├── chat.css            → チャットパネル + メッセージ (159行)
├── detail.css          → 詳細パネル + Big Five バー (233行)
├── modal.css           → モーダル共通 + 議論/パイプライン (288行)
└── agent-creator.css   → エージェント作成特有 (新規, 未作成)
```

### import 戦略

```css
/* index.css */
@import './variables.css';
@import './dashboard.css';
@import './sidebar.css';
@import './chat.css';
@import './detail.css';
@import './modal.css';
```

Vite が CSS を自動バンドルするため、パフォーマンスへの影響なし。

---

## 4. エラーハンドリング統一（完了）

### 導入前の問題

| モジュール | 現在のパターン | 問題 |
| --------- | ------------- | ------ |
| collective.js | `catch → console.error` | UIにエラーが伝搬しない |
| pipeline.js | `catch → フォールバック応答生成` | エラーが隠蔽される |
| synapse.js | `catch → 空配列 return` | サイレント失敗 |

### 導入した統一パターン

```javascript
// src/core/errors.js
export const ERROR_CODES = Object.freeze({
  API_LIMIT: 'API_LIMIT',
  NETWORK: 'NETWORK',
  AUTH: 'AUTH',
  FIRESTORE: 'FIRESTORE',
  VALIDATION: 'VALIDATION',
  UNKNOWN: 'UNKNOWN',
});

export class AppError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

export function classifyError(err) { /* ... */ }
```

### テスト

- `tests/unit/errors.test.js` — 9テスト PASS

### 今後の適用（Phase 3b で対応）

各モジュール（collective.js, pipeline.js, synapse.js）での `classifyError()` 呼び出し統合は
Task 5-6 のダッシュボード統合時に段階的に適用する。

---

## 5. テンプレート拡張 + agent.js 拡張（完了）

### personality.js 拡張

- `EXTENDED_PRESETS`: Nova（デザイナー）、Echo（アナリスト）、Ash（エンジニア）
- `getVoiceStyle()`: 名前ベースのプリセット + カスタムフォールバック

### agent.js 拡張

- `deleteAgent()`: Firestore ドキュメント削除
- `voiceStyle`: オプショナルフィールド（後方互換）
- `isPreset`: デフォルト `true`（後方互換）

### テスト結果

- `tests/unit/personality.test.js` — 23テスト PASS (+8)
- `tests/unit/agent.test.js` — 9テスト PASS (+3)
