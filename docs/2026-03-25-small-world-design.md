# Small World — 設計文書 v1.0

> **自律型 AI 組織エンジン**
> AI エージェントに個性・記憶・自律性を与え、組織として協働させる Web プラットフォーム

---

## 1. プロジェクト概要

### ビジョン

「Small World」は、AI エージェントを単なるツールではなく、**個性・記憶・感情を持つ自律的な存在**として扱い、それらが協働する「小さな世界」を Web ブラウザ上に構築するプラットフォーム。

### コンセプト

- AnimaWorks の「Organization-as-Code」哲学 + Claw-Empire の直感的 UI
- **Web 完結**（ブラウザだけで即体験、セットアップ不要）
- **HF Pro** で感情分析・性格モデリング — 既存プロジェクトにない独自価値
- **拡張可能なコアエンジン** — Phase 2 以降でどの方向にも発展可能

### ターゲット

- 学習・実験目的のプロトタイプ → 将来的に公開プロダクト化

---

## 2. アーキテクチャ概要

### レイヤー構成

```
┌─────────────────────────────────────────────────────┐
│                  Dashboard UI                        │
│  (エージェント一覧 / チャット / 関係性マップ / ログ)    │
├─────────────────────────────────────────────────────┤
│                 Autonomy Loop                        │
│  (ハートビート / 自発行動 / 状況判断)                  │
├─────────────────────────────────────────────────────┤
│                 Message Bus                          │
│  (DM / チャンネル / イベント通知 / Firestore Realtime) │
├─────────────────────────────────────────────────────┤
│                Memory System                         │
│  (短期記憶 / 長期記憶 / キーファクト抽出)              │
├─────────────────────────────────────────────────────┤
│                 Agent Core                           │
│  (個性 / 状態 / ロール / スキル / 気分)               │
├─────────────────────────────────────────────────────┤
│       Firebase        HF Pro        Vite             │
│   (Auth/Firestore)  (Inference)  (Frontend)          │
└─────────────────────────────────────────────────────┘
```

### 技術スタック

| レイヤー | 技術 | 選定理由 |
|---------|------|---------|
| フロントエンド | Vite + Vanilla JS + CSS | 軽量・高速。フレームワーク依存なし |
| 状態管理・DB | Firestore (リアルタイム) | onSnapshot でリアルタイム同期、スケーラブル |
| 認証 | Firebase Auth | Email/Password + 将来の OAuth 拡張 |
| AI 推論 | HF Inference API (@huggingface/inference) | チャット応答・感情分析・要約 |
| デプロイ | Firebase Hosting | ワンコマンドデプロイ |

---

## 3. コンポーネント設計

### 3.1 Agent Core（エージェント定義）

各エージェントは Firestore ドキュメントとして保存。

```javascript
// Firestore: /worlds/{worldId}/agents/{agentId}
{
  id: "agent_01",
  name: "Kai",
  role: "researcher",           // リサーチャー、ライター、マネージャー等
  personality: {
    // Big Five 性格特性（0.0〜1.0）
    openness: 0.8,              // 開放性
    conscientiousness: 0.6,     // 誠実性
    extraversion: 0.4,          // 外向性
    agreeableness: 0.7,         // 協調性
    neuroticism: 0.3            // 神経症傾向
  },
  systemPrompt: "あなたは好奇心旺盛なリサーチャーです...",
  mood: {
    current: "focused",         // 現在の気分
    energy: 0.8,                // エネルギー（0.0〜1.0）
    stress: 0.2                 // ストレス（0.0〜1.0）
  },
  status: "active",             // active / idle / sleeping
  avatar: {
    color: "#4A90D9",           // テーマカラー
    emoji: "🔬"                 // 簡易アバター
  },
  skills: ["research", "summarize", "translate"],
  createdAt: Timestamp,
  lastActiveAt: Timestamp
}
```

**設計判断**:
- `personality` は Big Five モデル採用 — 心理学的に確立されたフレームワーク
- `mood` はリアルタイムに変化 — HF 感情分析で自動更新
- `systemPrompt` は性格パラメータから自動生成可能だが、カスタムも許容

### 3.2 Memory System（記憶システム）

#### 短期記憶（Working Memory）

直近の会話コンテキスト。LLM のコンテキストウィンドウ内に収まる量。

```javascript
// Firestore: /worlds/{worldId}/agents/{agentId}/shortTermMemory/{memoryId}
{
  id: "mem_001",
  type: "conversation",         // conversation / observation / task
  content: "ユーザーが機械学習について質問した",
  participants: ["user", "agent_01"],
  timestamp: Timestamp,
  expiresAt: Timestamp          // 一定時間後に長期記憶へ統合 or 消去
}
```

#### 長期記憶（Long-Term Memory）

重要な情報を要約して永続保存。HF 要約モデルで圧縮。

```javascript
// Firestore: /worlds/{worldId}/agents/{agentId}/longTermMemory/{memoryId}
{
  id: "ltm_001",
  type: "fact",                 // fact / episode / skill
  content: "ユーザーは機械学習の初学者で、Python を学習中",
  source: "conversation",       // どこから得た知識か
  importance: 0.8,              // 重要度（0.0〜1.0）
  accessCount: 5,               // 参照回数（忘却に使用）
  lastAccessedAt: Timestamp,
  createdAt: Timestamp
}
```

**MVP での記憶フロー**:
1. 会話が発生 → 短期記憶に保存
2. 一定量溜まる or 重要な情報を検出 → HF で要約 → 長期記憶に統合
3. 次回の会話時 → 長期記憶から関連情報を取得 → プロンプトに注入

### 3.3 Message Bus（メッセージング）

エージェント間・ユーザー間のすべの通信を管理。

```javascript
// Firestore: /worlds/{worldId}/channels/{channelId}/messages/{messageId}
{
  id: "msg_001",
  channelId: "ch_general",
  senderId: "agent_01",         // エージェントID or "user"
  senderName: "Kai",
  content: "リサーチ結果をまとめました",
  type: "text",                 // text / system / action
  metadata: {
    sentiment: "positive",      // HF 感情分析結果
    confidence: 0.92
  },
  replyTo: null,                // スレッド返信用
  createdAt: Timestamp
}
```

**チャンネル設計**:

```javascript
// Firestore: /worlds/{worldId}/channels/{channelId}
{
  id: "ch_general",
  name: "General",
  type: "group",                // group / dm / system
  participants: ["user", "agent_01", "agent_02", "agent_03"],
  description: "全員が参加するメインチャンネル",
  createdAt: Timestamp
}
```

- `group`: 複数人チャンネル（Slack 的）
- `dm`: 1対1 の DM（ユーザー↔エージェント or エージェント↔エージェント）
- `system`: システム通知用

### 3.4 Autonomy Loop（自律行動ループ）

エージェントが自発的に思考・行動するための仕組み。

```javascript
// ハートビートの疑似コード
async function heartbeat(agent, world) {
  // 1. 現在の状況を把握
  const recentMessages = await getRecentMessages(world, agent.id, 10);
  const pendingTasks = await getPendingTasks(world, agent.id);
  const relationships = await getRelationships(world, agent.id);

  // 2. 長期記憶から関連情報を取得
  const relevantMemories = await recallMemories(agent, recentMessages);

  // 3. LLM に判断を委ねる
  const decision = await askLLM(agent, {
    personality: agent.personality,
    mood: agent.mood,
    recentMessages,
    pendingTasks,
    relationships,
    relevantMemories,
    prompt: `あなたは ${agent.name} です。
             現在の状況を見て、次に何をすべきか判断してください。
             選択肢: [メッセージを送る / タスクに取り組む / 休憩する / 何もしない]`
  });

  // 4. 決定に基づいてアクション実行
  await executeAction(agent, decision);

  // 5. 気分を更新（感情分析ベース）
  await updateMood(agent, decision);
}
```

**MVP でのハートビート実装**:
- `setInterval` でフロントエンドから定期実行（30秒〜60秒間隔）
- 判断は HF Inference API（チャットモデル）に委ねる
- **Phase 2** で Cloud Functions に移行（バックグラウンド実行）

### 3.5 Dashboard UI

#### 画面構成

```
┌─────────────────────────────────────────────────────────┐
│  🌍 Small World                        [Settings] [User] │
├──────────┬──────────────────────────────┬───────────────┤
│          │                              │               │
│  Agent   │       Chat Area              │  Agent        │
│  List    │                              │  Detail       │
│          │  ┌─────────────────────┐     │               │
│  ┌────┐  │  │ 💬 Messages         │     │  Name: Kai    │
│  │ 🔬 │  │  │                     │     │  Role: 研究者  │
│  │Kai │  │  │ Kai: リサーチ結果を  │     │  Mood: 😊     │
│  │    │  │  │ まとめました         │     │  Energy: 80%  │
│  ├────┤  │  │                     │     │  Stress: 20%  │
│  │ ✍️ │  │  │ Mia: ありがとう！   │     │               │
│  │Mia │  │  │ レビューします       │     │  ── 記憶 ──   │
│  │    │  │  │                     │     │  • ユーザーは  │
│  ├────┤  │  └─────────────────────┘     │    ML初学者   │
│  │ 📊 │  │                              │  • Pythonを   │
│  │Rex │  │  ┌─────────────────────┐     │    学習中     │
│  │    │  │  │ 📝 Input            │     │               │
│  └────┘  │  └─────────────────────┘     │  ── 関係性 ── │
│          │                              │  Mia: 友好的  │
│          │                              │  Rex: 中立    │
├──────────┴──────────────────────────────┴───────────────┤
│  Activity Log: Kai が General に投稿 | Rex が休憩中      │
└─────────────────────────────────────────────────────────┘
```

#### ページ構成

| ページ | パス | 内容 |
|-------|------|------|
| ログイン | `/login` | Firebase Auth |
| ワールド一覧 | `/worlds` | 自分のワールド管理 |
| ダッシュボード | `/world/:id` | メインUI（上記レイアウト） |
| エージェント作成 | `/world/:id/agents/new` | モーダル |
| 設定 | `/world/:id/settings` | ワールド設定 |

---

## 4. データフロー

### 4.1 ユーザーがメッセージを送信

```
ユーザー入力
    ↓
[Message Bus] Firestore に保存
    ↓
[onSnapshot] 対象エージェントがリアルタイム検知
    ↓
[Memory] 短期記憶に追加 + 長期記憶から関連情報を検索
    ↓
[Agent Core] 性格 + 記憶 + 気分 → プロンプト構築
    ↓
[HF Inference API] 応答生成
    ↓
[HF Sentiment] 応答の感情分析 → 気分更新
    ↓
[Message Bus] 応答を Firestore に保存
    ↓
[onSnapshot] UI にリアルタイム表示
```

### 4.2 ハートビート（自律行動）

```
setInterval (30秒ごと)
    ↓
[Autonomy] 対象エージェントの状況確認
    ↓
[Memory] 最近の活動 + 関連記憶を取得
    ↓
[HF Inference API] 「次に何をする？」を判断
    ↓
判断結果に応じて:
  ├── メッセージ送信 → Message Bus
  ├── タスク実行 → Task 更新
  ├── 休憩 → Status を idle に
  └── 何もしない → ログのみ
```

### 4.3 記憶の統合

```
短期記憶が 20 件を超えた時
    ↓
[HF Summarization] 短期記憶を要約
    ↓
[Memory] 要約を長期記憶として保存
    ↓
[Memory] 要約済みの短期記憶を削除
```

---

## 5. Firestore コレクション設計

```
/users/{userId}
  - displayName, email, createdAt

/worlds/{worldId}
  - name: "My Small World"
  - ownerId: userId
  - settings: { heartbeatInterval: 30000, maxAgents: 10 }
  - createdAt

/worlds/{worldId}/agents/{agentId}
  - (Agent Core スキーマ: セクション 3.1 参照)

/worlds/{worldId}/agents/{agentId}/shortTermMemory/{memoryId}
  - (短期記憶スキーマ: セクション 3.2 参照)

/worlds/{worldId}/agents/{agentId}/longTermMemory/{memoryId}
  - (長期記憶スキーマ: セクション 3.2 参照)

/worlds/{worldId}/channels/{channelId}
  - (チャンネルスキーマ: セクション 3.3 参照)

/worlds/{worldId}/channels/{channelId}/messages/{messageId}
  - (メッセージスキーマ: セクション 3.3 参照)

/worlds/{worldId}/relationships/{relationshipId}
  - agentA: agentId
  - agentB: agentId
  - affinity: 0.5 (0.0〜1.0)
  - interactions: 12
  - lastInteraction: Timestamp

/worlds/{worldId}/activityLog/{logId}
  - agentId, action, details, timestamp
```

---

## 6. HF Pro 活用マップ

| 機能 | HF モデル/API | 用途 |
|------|-------------|------|
| チャット応答 | `meta-llama/Llama-3.1-8B-Instruct` | エージェントの応答生成 |
| 感情分析 | `sentiment-analysis` パイプライン | メッセージの感情判定 → 気分更新 |
| テキスト要約 | `summarization` パイプライン | 短期→長期記憶の統合 |
| 性格分析 | `ppp57420/ocean-personality-distilbert` | Big Five スコア推定（将来） |
| テキスト分類 | `text-classification` パイプライン | メッセージの重要度判定 |
| 翻訳 | `translation` パイプライン | 多言語対応（将来） |

---

## 7. エラー処理

| エラー種別 | 対処 |
|-----------|------|
| HF API レート制限 | 指数バックオフ + キュー管理。ハートビート間隔を動的に延長 |
| HF API ダウン | フォールバックメッセージ表示 + リトライキュー |
| Firestore 権限エラー | Firebase Auth トークン検証 + エラートースト |
| エージェント応答タイムアウト | 15秒タイムアウト + 「考え中...」UI 表示 |
| 長期記憶の肥大化 | importance × accessCount でスコアリング、低スコアをアーカイブ |

---

## 8. セキュリティ

### Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザードキュメント
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // ワールド — オーナーのみ CRUD
    match /worlds/{worldId} {
      allow read, write: if request.auth != null
        && resource.data.ownerId == request.auth.uid;

      // サブコレクション — ワールドオーナーのみ
      match /{document=**} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/worlds/$(worldId)).data.ownerId == request.auth.uid;
      }
    }
  }
}
```

### API キー管理

- HF トークンは `.env` に保存、フロントエンドに直接埋め込まない
- MVP ではフロントエンドから HF API を呼ぶ（`.env.local` で管理）
- **Phase 2** で Cloud Functions 経由に移行（トークンをサーバー側に隔離）

---

## 9. MVP スコープ（Phase 1）

### やること ✅

| # | 機能 | 詳細 |
|---|------|------|
| 1 | Firebase Auth | Email/Password ログイン |
| 2 | ワールド作成 | 名前をつけて「小さな世界」を作る |
| 3 | エージェント定義 | 3体のプリセット（リサーチャー/ライター/マネージャー）|
| 4 | テキストチャット | ユーザー↔エージェント、エージェント↔エージェント |
| 5 | 基本メモリ | 短期記憶（会話履歴）+ 長期記憶（要約統合）|
| 6 | ハートビート | 30秒間隔で自律行動判断 |
| 7 | 感情分析 | HF でメッセージの感情判定 → 気分更新 |
| 8 | ダッシュボード UI | エージェント一覧・チャット・気分表示・アクティビティログ |
| 9 | 関係性トラッキング | エージェント間の交流頻度 → 親密度スコア |

### やらないこと（Phase 2 以降）❌

| 機能 | Phase |
|------|-------|
| 脳科学ベースの記憶統合・忘却 | Phase 2a (Synapse) |
| タスクパイプライン・分業 | Phase 2b (Atelier) |
| 議論・合意形成エンジン | Phase 2c (Collective) |
| 3D/2D ビジュアルワークスペース | Phase 3 |
| 音声チャット | Phase 4 |
| エージェントのカスタム作成 UI | Phase 2 |
| Cloud Functions 移行 | Phase 2 |
| 外部ツール統合 | Phase 4 |
| 公開・マルチテナント | Phase 5 |

---

## 10. テスト方針

| 種別 | 対象 | 比率 |
|------|------|------|
| Unit | Agent Core（性格→プロンプト変換）、メモリ管理 | 50% |
| Integration | Firestore CRUD、HF API 呼び出し、メッセージフロー | 35% |
| E2E | ログイン → ワールド作成 → チャット → 応答確認 | 15% |

---

## 11. ディレクトリ構成（予定）

```
small-world/
├── index.html
├── vite.config.js
├── package.json
├── .env.example
├── .gitignore
├── firebase.json
├── firestore.rules
├── src/
│   ├── main.js                  # エントリーポイント
│   ├── app.js                   # ルーティング・初期化
│   ├── config/
│   │   ├── firebase.js          # Firebase 初期化
│   │   └── hf.js                # HuggingFace 初期化
│   ├── core/
│   │   ├── agent.js             # Agent Core ロジック
│   │   ├── memory.js            # Memory System
│   │   ├── messageBus.js        # Message Bus
│   │   ├── autonomy.js          # Autonomy Loop（ハートビート）
│   │   └── personality.js       # 性格→プロンプト変換
│   ├── services/
│   │   ├── hfService.js         # HF Inference API ラッパー
│   │   ├── firestoreService.js  # Firestore CRUD
│   │   └── authService.js       # Firebase Auth
│   ├── ui/
│   │   ├── pages/
│   │   │   ├── login.js         # ログインページ
│   │   │   ├── worlds.js        # ワールド一覧
│   │   │   └── dashboard.js     # メインダッシュボード
│   │   ├── components/
│   │   │   ├── agentList.js     # エージェント一覧
│   │   │   ├── chatPanel.js     # チャットパネル
│   │   │   ├── agentDetail.js   # エージェント詳細
│   │   │   ├── activityLog.js   # アクティビティログ
│   │   │   └── moodIndicator.js # 気分インジケーター
│   │   └── router.js            # SPA ルーター
│   └── styles/
│       ├── index.css            # グローバルスタイル
│       ├── variables.css        # CSS カスタムプロパティ
│       ├── dashboard.css        # ダッシュボード
│       └── components.css       # コンポーネント
├── tests/
│   ├── unit/
│   │   ├── agent.test.js
│   │   ├── memory.test.js
│   │   └── personality.test.js
│   └── integration/
│       ├── firestore.test.js
│       └── hfService.test.js
└── docs/
    └── ultrapower/
        └── specs/
            └── 2026-03-25-small-world-design.md  # この文書
```

---

## 12. 拡張ロードマップ

```
Phase 1: Core Engine（MVP）  ← 現在
  │
  ├── Phase 2a: Advanced Memory（Synapse 方向）
  │   記憶の統合・忘却・セマンティック検索・RAG
  │
  ├── Phase 2b: Task Pipeline（Atelier 方向）
  │   ワークフロー設計・分業・成果物制作
  │
  └── Phase 2c: Discussion Engine（Collective 方向）
  │   多角的議論・合意形成・レポート出力
  │
  ├── Phase 3: Visual Workspace
  │   2D/3D オフィス可視化・関係性ネットワーク図
  │
  ├── Phase 4: Voice + External Tools
  │   音声チャット・外部 API 統合・コード実行
  │
  └── Phase 5: Public Platform
      マルチテナント・テンプレート共有・コミュニティ
```
