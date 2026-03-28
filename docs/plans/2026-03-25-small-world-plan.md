# Small World — 実装計画 v1.0

> 設計文書: `docs/ultrapower/specs/2026-03-25-small-world-design.md`
> レビューモード: 簡易（学習/プロトタイプ PJ）
> スコープモード: SELECTIVE（MVPベースライン＋必要に応じて拡張）

---

## CEO Review（簡易）

### 前提チャレンジ

| 質問 | 回答 |
|------|------|
| 正しい問題か？ | ✅ マルチエージェント AI 組織の学習 + プロダクト探索 |
| 何もしなかったら？ | 学習機会を逃す。市場にブラウザ完結型のAI組織ツールは存在しない |
| 既存コードの活用 | Ultrapower フレームワーク（開発プロセス）、Firebase/HF の既存ノウハウ |

### 代替案

```
APPROACH A: フルスタッククライアント（推奨・採用）
  概要:   Vite + Firebase + HF API。フロントエンドからすべて実行
  工数:   M（中規模）
  リスク: Med（HF APIのレート制限、フロントエンドでのトークン露出）
  利点:   即座に動く、デプロイ簡単、学習効果が高い
  欠点:   APIキーがクライアント側、スケーラビリティ制限

APPROACH B: Cloud Functions バックエンド
  概要:   Firebase Cloud Functions 経由で HF API を呼ぶ
  工数:   L（大規模）
  リスク: Low（APIキー隠蔽、レート制限管理）
  利点:   セキュア、スケーラブル
  欠点:   開発速度が遅い、コールドスタート問題
```

→ MVP は **APPROACH A** で高速に構築。Phase 2 で B に移行。

---

## Eng Review（簡易）

### 主要原則チェック

| 原則 | 判定 | 備考 |
|------|------|------|
| Blast Radius | ✅ | 新規PJなので影響範囲は自プロジェクト内のみ |
| Boring by Default | ✅ | Firebase, Vite, Vanilla JS — すべて実績のある技術 |
| Reversibility | ✅ | Firebase Hosting でロールバック可能 |

### スコープチャレンジ

- 新規ファイル数: 約 20 ファイル（許容範囲）
- 外部依存: Firebase SDK + @huggingface/inference の 2 つのみ
- 完全性チェック: MVP スコープは設計文書セクション 9 で明確に定義済み

---

## 実装タスク一覧

### Phase 0: プロジェクト基盤（タスク 1-3）

---

## Task 1: プロジェクト初期化

### テスト（RED）
- テストファイル: `tests/unit/config.test.js`
- テスト内容: Firebase / HF の設定モジュールが正しくエクスポートされること

### 実装（GREEN）
- Vite プロジェクト作成（`npx create-vite@latest ./`）
- `package.json` に依存追加: `firebase`, `@huggingface/inference`
- `.env.example` に必要な環境変数を定義
- `.gitignore` 作成
- `vite.config.js` 設定

### 検証コマンド
- `npm run dev` → 開発サーバー起動確認

---

## Task 2: Firebase セットアップ

### テスト（RED）
- テストファイル: `tests/unit/firebase.test.js`
- テスト内容: Firebase app が初期化されること、Firestore / Auth インスタンスが取得できること

### 実装（GREEN）
- `src/config/firebase.js` — Firebase 初期化（Auth + Firestore）
- `firebase.json` — Hosting 設定
- `firestore.rules` — セキュリティルール（設計文書セクション 8）
- Firebase プロジェクトとの紐付け

### 検証コマンド
- `npm test -- tests/unit/firebase.test.js`

---

## Task 3: HF Inference API セットアップ

### テスト（RED）
- テストファイル: `tests/unit/hfService.test.js`
- テスト内容: HfInference クライアントが初期化されること、chatCompletion / sentimentAnalysis のラッパーが存在すること

### 実装（GREEN）
- `src/config/hf.js` — HF クライアント初期化
- `src/services/hfService.js` — 以下のラッパー:
  - `chat(messages, options)` — チャット応答生成
  - `analyzeSentiment(text)` — 感情分析
  - `summarize(text)` — テキスト要約

### 検証コマンド
- `npm test -- tests/unit/hfService.test.js`

---

### Phase 1: Agent Core（タスク 4-5）

---

## Task 4: Agent Core — データモデル & CRUD

### テスト（RED）
- テストファイル: `tests/unit/agent.test.js`
- テスト内容:
  - エージェント作成（Big Five 性格パラメータ含む）
  - エージェント取得（ID 指定）
  - エージェント一覧取得
  - エージェント更新（気分更新）

### 実装（GREEN）
- `src/core/agent.js`:
  - `createAgent(worldId, agentData)` → Firestore 保存
  - `getAgent(worldId, agentId)` → 取得
  - `listAgents(worldId)` → 一覧
  - `updateAgent(worldId, agentId, updates)` → 更新
- `src/services/firestoreService.js`:
  - Firestore CRUD の汎用ラッパー

### 検証コマンド
- `npm test -- tests/unit/agent.test.js`

---

## Task 5: Personality → System Prompt 変換

### テスト（RED）
- テストファイル: `tests/unit/personality.test.js`
- テスト内容:
  - Big Five パラメータからシステムプロンプトが生成されること
  - 外向性が高いエージェントは「積極的に会話」するプロンプトになること
  - 誠実性が高いエージェントは「正確さを重視」するプロンプトになること

### 実装（GREEN）
- `src/core/personality.js`:
  - `generateSystemPrompt(agent)` — 性格 + ロール → プロンプト生成
  - `describeMood(mood)` — 気分をプロンプト用テキストに変換
  - プリセットエージェント定義（3体分）:
    - **Kai**（リサーチャー）: 開放性↑、外向性↓
    - **Mia**（ライター）: 協調性↑、誠実性↑
    - **Rex**（マネージャー）: 外向性↑、神経症傾向↓

### 検証コマンド
- `npm test -- tests/unit/personality.test.js`

---

### Phase 2: Memory System（タスク 6-7）

---

## Task 6: 短期記憶（Working Memory）

### テスト（RED）
- テストファイル: `tests/unit/memory.test.js`
- テスト内容:
  - 会話を短期記憶に保存できること
  - 直近 N 件の記憶を取得できること
  - 記憶数が閾値を超えたら統合フラグが立つこと

### 実装（GREEN）
- `src/core/memory.js`:
  - `addShortTermMemory(worldId, agentId, memory)` → 保存
  - `getRecentMemories(worldId, agentId, limit)` → 最近 N 件取得
  - `checkConsolidationNeeded(worldId, agentId)` → 閾値チェック

### 検証コマンド
- `npm test -- tests/unit/memory.test.js`

---

## Task 7: 長期記憶（統合 & 検索）

### テスト（RED）
- テストファイル: `tests/integration/memory-consolidation.test.js`
- テスト内容:
  - 短期記憶を HF で要約 → 長期記憶に保存できること
  - 長期記憶からキーワードで検索できること
  - 統合後に短期記憶がクリアされること

### 実装（GREEN）
- `src/core/memory.js` に追加:
  - `consolidateMemories(worldId, agentId)` — 短期→要約→長期
  - `recallMemories(worldId, agentId, query)` — 長期記憶検索
  - `clearConsolidatedShortTerm(worldId, agentId)` — 統合済み削除

### 検証コマンド
- `npm test -- tests/integration/memory-consolidation.test.js`

---

### Phase 3: Message Bus（タスク 8-9）

---

## Task 8: チャンネル & メッセージ CRUD

### テスト（RED）
- テストファイル: `tests/unit/messageBus.test.js`
- テスト内容:
  - チャンネル作成（group / dm）
  - メッセージ送信
  - メッセージ一覧取得（ページネーション）

### 実装（GREEN）
- `src/core/messageBus.js`:
  - `createChannel(worldId, channelData)` → チャンネル作成
  - `sendMessage(worldId, channelId, message)` → メッセージ送信
  - `getMessages(worldId, channelId, options)` → メッセージ取得
  - `subscribeToChannel(worldId, channelId, callback)` → onSnapshot リアルタイム購読

### 検証コマンド
- `npm test -- tests/unit/messageBus.test.js`

---

## Task 9: エージェント応答フロー

### テスト（RED）
- テストファイル: `tests/integration/agent-response.test.js`
- テスト内容:
  - ユーザーメッセージ → エージェントが記憶を参照して応答すること
  - 応答に感情分析メタデータが付与されること
  - 気分が応答後に更新されること

### 実装（GREEN）
- `src/core/messageBus.js` に追加:
  - `handleIncomingMessage(worldId, agentId, message)`:
    1. 短期記憶に追加
    2. 長期記憶から関連情報を検索
    3. 性格 + 記憶 + 気分 → プロンプト構築
    4. HF API で応答生成
    5. 感情分析 → 気分更新
    6. 応答をチャンネルに投稿

### 検証コマンド
- `npm test -- tests/integration/agent-response.test.js`

---

### Phase 4: Autonomy Loop（タスク 10）

---

## Task 10: ハートビート（自律行動）

### テスト（RED）
- テストファイル: `tests/unit/autonomy.test.js`
- テスト内容:
  - ハートビートが状況を収集すること
  - LLM の判断に基づいてアクションが実行されること
  - 「何もしない」判断が正しく処理されること

### 実装（GREEN）
- `src/core/autonomy.js`:
  - `heartbeat(worldId, agentId)` — 1回のハートビートサイクル
  - `startHeartbeatLoop(worldId, agentId, intervalMs)` — 定期実行開始
  - `stopHeartbeatLoop(agentId)` — 停止
  - `collectContext(worldId, agentId)` — 状況収集
  - `executeAction(worldId, agentId, decision)` — アクション実行

### 検証コマンド
- `npm test -- tests/unit/autonomy.test.js`

---

### Phase 5: UI — 認証 & ワールド管理（タスク 11-12）

---

## Task 11: ログインページ & Firebase Auth

### テスト（RED）
- テストファイル: なし（CSS/UI — ブラウザで視覚確認）

### 実装（GREEN）
- `src/services/authService.js`:
  - `signUp(email, password)` → アカウント作成
  - `signIn(email, password)` → ログイン
  - `signOut()` → ログアウト
  - `onAuthStateChanged(callback)` → 認証状態監視
- `src/ui/pages/login.js`:
  - ログインフォーム（Email/Password）
  - 新規登録フォーム
  - エラーハンドリング（不正メール、パスワード不一致等）
- `src/styles/login.css`

### 検証コマンド
- ブラウザでログイン/サインアップの動作確認

---

## Task 12: ワールド一覧 & 作成

### テスト（RED）
- テストファイル: `tests/unit/world.test.js`
- テスト内容: ワールド CRUD（作成・取得・一覧）

### 実装（GREEN）
- `src/services/worldService.js`:
  - `createWorld(userId, name)` → 新規ワールド作成 + プリセットエージェント3体 + General チャンネル自動作成
  - `listWorlds(userId)` → ワールド一覧
  - `getWorld(worldId)` → ワールド取得
- `src/ui/pages/worlds.js`:
  - ワールド一覧カード表示
  - 新規作成モーダル
- `src/styles/worlds.css`

### 検証コマンド
- `npm test -- tests/unit/world.test.js`
- ブラウザでワールド作成の動作確認

---

### Phase 6: UI — メインダッシュボード（タスク 13-16）

---

## Task 13: ダッシュボードレイアウト & ルーティング

### テスト（RED）
- テストファイル: なし（CSS/UI）

### 実装（GREEN）
- `src/ui/router.js` — Hash ベースの SPA ルーター
- `src/ui/pages/dashboard.js` — 3カラムレイアウト
- `src/app.js` — ルーティング初期化 + 認証ガード
- `src/main.js` — エントリーポイント
- `src/styles/dashboard.css`
- `src/styles/variables.css` — デザイントークン
- `src/styles/index.css` — グローバルスタイル

### 検証コマンド
- ブラウザでページ遷移の動作確認

---

## Task 14: エージェント一覧パネル

### テスト（RED）
- テストファイル: なし（CSS/UI）

### 実装（GREEN）
- `src/ui/components/agentList.js`:
  - Firestore onSnapshot でリアルタイム更新
  - アバター（カラー + 絵文字）
  - ステータス（active / idle / sleeping）
  - 気分インジケーター（エネルギー + ストレス バー）
  - クリックでエージェント選択 → チャットパネル & 詳細連動
- `src/ui/components/moodIndicator.js`:
  - エネルギー / ストレスの視覚表示
- `src/styles/components.css`

### 検証コマンド
- ブラウザで動作確認

---

## Task 15: チャットパネル

### テスト（RED）
- テストファイル: なし（CSS/UI）

### 実装（GREEN）
- `src/ui/components/chatPanel.js`:
  - チャンネル切替（General / DM）
  - メッセージ表示（送信者名、アバター、タイムスタンプ、感情バッジ）
  - メッセージ入力 & 送信
  - Firestore onSnapshot でリアルタイム更新
  - 自動スクロール
  - 「考え中...」インジケーター

### 検証コマンド
- ブラウザでチャット送受信の動作確認

---

## Task 16: エージェント詳細パネル & アクティビティログ

### テスト（RED）
- テストファイル: なし（CSS/UI）

### 実装（GREEN）
- `src/ui/components/agentDetail.js`:
  - エージェント基本情報（名前、ロール、性格レーダーチャート）
  - 気分パラメータ（energy / stress — リアルタイム更新）
  - 長期記憶一覧
  - 関係性リスト（他エージェントとの親密度）
- `src/ui/components/activityLog.js`:
  - 全エージェントのアクティビティをタイムライン表示
  - フィルター（エージェント別、アクション別）

### 検証コマンド
- ブラウザで動作確認

---

### Phase 7: 統合 & 仕上げ（タスク 17-18）

---

## Task 17: エンドツーエンド統合

### テスト（RED）
- テストファイル: `tests/e2e/full-flow.test.js`
- テスト内容:
  - ログイン → ワールド作成 → エージェント3体確認 → メッセージ送信 → 応答受信
  - ハートビートでエージェントが自律的にメッセージ送信
  - 気分がメッセージに応じて変化

### 実装（GREEN）
- 各コンポーネントの統合接続
- ワールド初期化時のプリセットエージェント自動作成
- ハートビート自動開始/停止の制御

### 検証コマンド
- `npm test -- tests/e2e/full-flow.test.js`
- ブラウザで全フローの動作確認

---

## Task 18: デプロイ & 最終確認

### 実装
- `firebase deploy` で Hosting + Firestore Rules デプロイ
- `.env` から `.env.example` へのドキュメント整備
- README.md 作成

### 検証コマンド
- `firebase deploy`
- デプロイ URL でのアクセス確認

---

## タスク依存関係

```
Task 1 (プロジェクト初期化)
  ├── Task 2 (Firebase)
  │     └── Task 4 (Agent Core)
  │           ├── Task 5 (Personality)
  │           ├── Task 6 (短期記憶)
  │           │     └── Task 7 (長期記憶)
  │           ├── Task 8 (Message Bus)
  │           │     └── Task 9 (応答フロー)
  │           │           └── Task 10 (ハートビート)
  │           ├── Task 11 (Auth UI)
  │           └── Task 12 (World管理)
  │                 ├── Task 13 (Dashboard)
  │                 │     ├── Task 14 (Agent List)
  │                 │     ├── Task 15 (Chat Panel)
  │                 │     └── Task 16 (Detail/Log)
  │                 └── Task 17 (E2E統合)
  │                       └── Task 18 (デプロイ)
  └── Task 3 (HF API)
        └── (Task 5, 7, 9 で使用)
```

---

## 工数見積もり

| Phase | タスク | 概算 |
|-------|--------|------|
| Phase 0 | Task 1-3: 基盤セットアップ | 短 |
| Phase 1 | Task 4-5: Agent Core | 中 |
| Phase 2 | Task 6-7: Memory | 中 |
| Phase 3 | Task 8-9: Message Bus | 中 |
| Phase 4 | Task 10: Autonomy | 中 |
| Phase 5 | Task 11-12: Auth & World UI | 短〜中 |
| Phase 6 | Task 13-16: Dashboard UI | 長 |
| Phase 7 | Task 17-18: 統合 & デプロイ | 中 |

---

## Design UX レビュー（簡易）

### 情報設計
- 第1: エージェント一覧（誰がいるか） → 第2: チャット（会話する） → 第3: 詳細（深く知る）
- 3カラムレイアウトは情報の自然な流れに沿っている ✅

### インタラクション状態

| 機能 | Loading | Empty | Error | Success |
|------|---------|-------|-------|---------|
| ワールド一覧 | ✅ | ✅ 作成促進 | ✅ | ✅ |
| チャット | ✅ 考え中... | ✅ 会話開始促進 | ✅ API失敗表示 | ✅ |
| エージェント一覧 | ✅ | N/A（プリセット3体） | ✅ | ✅ |

### Wow Factor
- 気分インジケーターのリアルタイム変化（微アニメーション）
- エージェント同士の自律的会話がリアルタイムで表示される体験
- 感情バッジ付きメッセージ（ポジティブ=緑、ネガティブ=赤、中立=グレー）

---

```
╔══════════════════════════════════════════════════════════════╗
║  ULTRA-PLAN — 完了サマリー                                    ║
║  STATUS: DONE                                                ║
╠══════════════════════════════════════════════════════════════╣
║  CEO Review:    Mode: SELECTIVE                              ║
║  Eng Review:    Issues: 0, Critical Gaps: 0                  ║
║  Design Review: Score: 8/10 (UI scope: Y)                    ║
║  Lake Score:    全推奨で完全版を選択                            ║
║  タスク数:      18 タスク（7 Phase）                           ║
║  次のフェーズ:  ultra-implement                                ║
╚══════════════════════════════════════════════════════════════╝
```
