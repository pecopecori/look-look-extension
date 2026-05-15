# 開発プロジェクト ローカルルール

このファイルは `/Users/demo/開発/` プロジェクト固有のルールを定めます。
全プロジェクト共通ルール（`/Users/demo/CLAUDE.md`）に加えて、以下を適用してください。

---

## Asana API 統合ルール

### トークン管理

1. **環境変数の使用**
   - `ASANA_PERSONAL_ACCESS_TOKEN` 環境変数でのみトークンを参照
   - スクリプト・コード内に直書き厳禁
   - `.env` ファイルに記載：`ASANA_PERSONAL_ACCESS_TOKEN=...`

2. **`.env` ファイルの作成・管理**
   - `.env` は必ず `.gitignore` と同時に作成
   - リモートリポジトリには含めない（秘密鍵扱い）
   - チーム内で共有する場合は `.env.example` で形式のみ共有

3. **`.gitignore` の更新**
   ```
   .env
   .env.local
   .env.*.local
   ```

### Asana API エンドポイント

Base URL: `https://app.asana.com/api/1.0`

主要エンドポイント：
- `GET /users/me` - 現在のユーザー情報（ワークスペースGID取得用）
- `GET /workspaces/{gid}/projects` - プロジェクト一覧取得
- `POST /projects/{gid}/sections` - セクション作成
- `POST /projects/{gid}/tasks` - タスク作成
- `POST /tasks/{gid}/subtasks` - サブタスク作成

詳細は `/Users/demo/開発/.claude/commands/asana-add-tasks.md` を参照。

### 認証方式

- **方式**: Bearer Token
- **ヘッダー**: `Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN`
- **トークン取得**: Asana → Personal Settings → API Tokens

### タスク構造の標準化

Asanaに登録するタスク階層：

```
Project（プロジェクト）
  ├─ Section（セクション） = 要件定義・設計・実装など
  │   ├─ Task（親タスク）= 大項目（例：ユーザー認証機能）
  │   │   ├─ Subtask（サブタスク）= 小項目
  │   │   └─ Subtask
```

---

## スクリプト・自動化ルール

### マークダウン形式でのタスク入力

```markdown
# セクション名
説明（オプション）

## 親タスク名
- サブタスク1
- サブタスク2
- サブタスク3
```

このフォーマットで `/asana-add-tasks` コマンドに入力。

### 実行権限

curl、python3実行の許可をプロジェクト `.claude/settings.local.json` に設定済み：
- `Bash(curl -s -X GET "https://app.asana.com/api/1.0/*")`
- `Bash(curl -s -X POST "https://app.asana.com/api/1.0/*")`
- `Bash(python3 -c "import sys,json;*")`

---

## セキュリティ

### 厳禁事項

1. **トークンの直書き**
   - コード内、設定ファイル、コミットメッセージ内に絶対に含めない

2. **ログ出力**
   - トークンを含むAPIレスポンスはログから除外
   - `jq` でマスク処理を検討

3. **Git管理**
   - `.env*` は全て `.gitignore` に追加
   - プッシュ前に `git status` で確認

### コード実装時の注意

- 環境変数から読み込む：`os.getenv("ASANA_PERSONAL_ACCESS_TOKEN")`（Python）、`$ASANA_PERSONAL_ACCESS_TOKEN`（Bash）
- API レスポンスにエラーハンドリング追加
- レート制限（RateLimit ヘッダー）に対応

---

## 適用範囲

このファイルは `/Users/demo/開発/` プロジェクト内のすべてのサブディレクトリに適用されます。

