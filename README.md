# GeminiSpector

**多人格生成 + Gemini APIクロスチェックシステム**

---

## 🌟 概要

**GeminiSpector**は、ChatGPT (三人格) で生成したコンテンツに対し、必要に応じてGoogle Gemini APIを呼び出して評価・検証するハイブリッドAIエージェントです。

このシステムは「Alpha (論理)」「Beta (共感)」「Gamma (創造)」の3人格を中心に応答を生成し、品質の向上・信頼性の強化を目指します。

---

## 🛠️ 機能

✅ 三人格応答生成  
✅ ジャッジ（スコア・コメントによる評価）  
✅ ファクトチェック（事実確認・出典提示）  
✅ Gemini APIを利用したクロスモデル検証  
✅ ユーザー通知（Gemini呼び出し時に明示）  

---

## ⚙️ 技術構成

- **Google Gemini API (2.5 Flash)**（応答生成・評価）
- **Render.com**（インフラ・デプロイ）
- Node.js / Python（実装予定）

---

## 📂 ディレクトリ構成
.
├── prompts/
│   ├── rules_prompt.md
│   ├── navigator_prompt.md
│   ├── judge_prompt.md
│   ├── factcheck_prompt.md
│   └── personas.yaml
├── src/
│   └── factcheck-system/ # Gemini API を使ったファクトチェック
├── dist/                 # TypeScript ビルド成果物
├── docs/
│   └── agent.md
├── .env.example
├── README.md
└── package.json

---

## 📝 セットアップ

1. リポジトリをクローン
git clone https://github.com/your-org/GeminiSpector.git
cd GeminiSpector

2. 環境変数を設定
cp .env.example .env

`.env` に以下を設定:
GEMINI_API_KEY=your_gemini_api_key
3. 依存パッケージインストール
npm install

4. サーバー起動
npm start

5. デプロイ (Render.com推奨)

---

## 🚀 使い方

- ChatGPTが三人格で応答を生成
- 必要に応じて「ジャッジ」「ファクトチェック」を呼ぶ
- Gemini APIで外部検証を実施
- 結果をユーザーに通知・表示

### APIエンドポイント
 - **POST /api/chat** : 三人格で応答を生成します。
 - **POST /factcheck** : 文章から主張を抽出し、Geminiで検証します。
 - **POST /text/evaluate** : Geminiを利用して文章を採点し、必要に応じて訂正文も返します。

`/text/evaluate` はまず correctness を採点し、点数が低い場合のみ訂正文を生成する二段階方式です。

---

## 📖 ドキュメント

- `docs/agent.md` : システム指示書
- `prompts/` : 各種プロンプト定義

---

## 🧭 今後の展望

- ログDBによる履歴管理
- UIフロントの追加
- 他AIモデルとの連携拡張

---

## 📝 ライセンス

MIT License

