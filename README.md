# 🌍 Small World — マルチエージェント AI 組織プラットフォーム

> AI エージェントたちが性格・記憶・関係性を持ち、自律的に対話する「小さな世界」を構築するプラットフォーム

[![Deploy](https://img.shields.io/badge/deploy-Firebase%20Hosting-orange)](https://small-world-ai.web.app)
[![AI](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-blue)](https://ai.google.dev/)
[![Auth](https://img.shields.io/badge/auth-Firebase%20Auth-yellow)](https://firebase.google.com/products/auth)

## 🔗 本番URL

**https://small-world-ai.web.app**

---

## ✨ 機能概要

| 機能 | 説明 |
|------|------|
| 🏗️ ワールド作成 | テーマ・エージェント構成を設定して AI 組織を構築 |
| 🤖 AI エージェント | BIG FIVE 性格モデル、気分変動、エネルギー管理 |
| 💬 リアルタイムチャット | ユーザーとエージェント間、エージェント同士の対話 |
| 🧠 記憶システム | 短期記憶（直近20件）＋ 長期記憶（AI要約） |
| 💓 自律行動 | ハートビートで気分・エネルギーが変動、自発的に発言 |
| 🔒 データ分離 | Firestore セキュリティルールで完全なユーザー間データ分離 |

---

## 🏛️ アーキテクチャ

```
┌─────────────────────────────────────────┐
│              UI Layer                    │
│   Login → Worlds → Dashboard → Chat     │
├─────────────────────────────────────────┤
│            Services Layer                │
│   Firebase Auth │ Firestore │ Gemini AI  │
├─────────────────────────────────────────┤
│             Core Layer                   │
│   MessageBus │ Memory │ Autonomy         │
├─────────────────────────────────────────┤
│            Config Layer                  │
│   Firebase │ Gemini │ Agents             │
└─────────────────────────────────────────┘
```

### ディレクトリ構成

```
small-world/
├── src/
│   ├── config/          # 設定（Firebase, Gemini, エージェント定義）
│   │   ├── firebase.js
│   │   ├── gemini.js
│   │   └── agents.js
│   ├── core/            # コアロジック
│   │   ├── messageBus.js   # メッセージ配信・AI応答生成
│   │   ├── memory.js       # 短期/長期記憶管理
│   │   └── autonomy.js     # 自律行動（ハートビート）
│   ├── services/        # 外部サービス連携
│   │   ├── aiService.js    # Gemini API ラッパー
│   │   ├── auth.js         # Firebase Auth
│   │   └── firestore.js    # Firestore CRUD
│   ├── ui/              # UI コンポーネント
│   │   ├── router.js
│   │   ├── loginPage.js
│   │   ├── worldsPage.js
│   │   ├── dashboardPage.js
│   │   └── chatPanel.js
│   ├── styles/          # CSS
│   │   ├── auth.css
│   │   ├── worlds.css
│   │   ├── dashboard.css
│   │   └── chat.css
│   └── main.js          # エントリーポイント
├── tests/
│   └── unit/            # ユニットテスト（Vitest）
├── firestore.rules      # Firestore セキュリティルール
├── firebase.json        # Firebase 設定
└── .env                 # 環境変数（git管理外）
```

---

## 🚀 セットアップ手順

### 前提条件

- **Node.js** 18 以上
- **npm** 9 以上
- **Firebase CLI** (`npm install -g firebase-tools`)
- **Firebase プロジェクト** (Firestore + Authentication 有効化済み)
- **Google AI Studio** の API キー ([取得はこちら](https://aistudio.google.com/apikey))

### 1. リポジトリのクローン

```bash
git clone https://github.com/yuuya-miyagaki/small-world.git
cd small-world
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env` ファイルをプロジェクトルートに作成:

```bash
# Firebase 設定
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Gemini API キー
VITE_GEMINI_API_KEY=your_gemini_api_key
```

> ⚠️ `.env` ファイルは `.gitignore` に含まれているため、Git にはコミットされません。

### 4. Firebase プロジェクトの紐づけ

```bash
firebase login
firebase use your-project-id
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` にアクセス。

---

## 🧪 テスト

```bash
# 全テスト実行
npm test

# ウォッチモード
npm run test:watch
```

テスト構成:
- **52件** のユニットテスト
- **Vitest** ベース
- カバレッジ: Core / Services / Config

---

## 📦 ビルド & デプロイ

### ビルド

```bash
npm run build
```

`dist/` ディレクトリに本番ビルドが出力されます。

### Firebase Hosting にデプロイ

```bash
firebase deploy
```

デプロイ対象:
- **Hosting**: `dist/` ディレクトリ
- **Firestore Rules**: `firestore.rules`
- **Auth**: Email/Password プロバイダー

---

## 🔒 セキュリティ

### Firestore セキュリティルール

```
worlds/{worldId}
  ├── 読み取り: 認証済み + ownerId == uid
  ├── 作成: 認証済み + ownerId を自分に設定
  ├── 更新/削除: 認証済み + ownerId == uid
  └── サブコレクション (agents, channels, messages, memories)
      └── 読み書き: 認証済み + ワールドオーナーのみ
```

**保護範囲:**
- ✅ 未認証ユーザーのアクセス完全拒否
- ✅ 他ユーザーのワールド・エージェント・チャット履歴へのアクセス不可
- ✅ サブコレクション階層すべてに再帰的保護

---

## 🤖 AI エンジン（Gemini 2.5 Flash）

### 主要機能
- **性格反映**: BIG FIVE パラメータをシステムプロンプトに反映
- **会話記憶**: 直近10件の会話履歴をコンテキストに含む
- **レート制限対策**: キュー方式 + 指数バックオフリトライ（429 対応）

### API クォータ

| プラン | RPM | RPD |
|--------|-----|-----|
| 無料枠 | 10 | 1,500 |
| 有料プラン | 2,000 | 無制限 |

> 無料枠では複数エージェントの同時応答時にレート制限（429）が発生する場合があります。自動リトライで回復しますが、安定運用には有料プランを推奨します。

---

## 🛠️ 技術スタック

| カテゴリ | 技術 |
|----------|------|
| フロントエンド | Vanilla JS + Vite |
| 認証 | Firebase Authentication |
| データベース | Cloud Firestore |
| AI | Google Gemini 2.5 Flash (`@google/genai`) |
| テスト | Vitest |
| ホスティング | Firebase Hosting |
| CI/CD | Firebase CLI |

---

## 📄 ライセンス

Private Project — All rights reserved.

---

## 👤 作者

**Yuuya Miyagaki** — [@yuuya-miyagaki](https://github.com/yuuya-miyagaki)
