# asana-add-tasks コマンド

Asana APIを用いて、マークダウン形式で記述したタスク群を自動的にAsanaプロジェクトに追加します。

## 前提条件

- `ASANA_PERSONAL_ACCESS_TOKEN` 環境変数が設定されていること（通常は `.env` ファイルから読み込み）
- 対象プロジェクトがAsana内に存在すること
- ワークスペース名が明確であること

## 使用方法

```bash
/asana-add-tasks
```

入力形式（マークダウン）：

```
# グループ名（セクション）
## カテゴリ名（親タスク）
- タスクA（サブタスク）
- タスクB（サブタスク）

## 別カテゴリ
- タスクC
- タスクD
```

## 処理の流れ

1. **ワークスペース確認**: 個人ワークスペースのGID取得
2. **プロジェクト確認**: 指定されたプロジェクト名のGID確認
3. **セクション作成**: グループ名でセクション作成（既存チェック有）
4. **親タスク作成**: カテゴリ名で親タスク作成
5. **サブタスク作成**: リスト項目をサブタスクとして親タスク配下に作成

## API エンドポイント

| 操作 | メソッド | エンドポイント |
|------|---------|----------------|
| ワークスペース確認 | GET | `/users/me` |
| プロジェクト確認 | GET | `/workspaces/{gid}/projects` |
| セクション作成 | POST | `/projects/{gid}/sections` |
| 親タスク作成 | POST | `/projects/{gid}/tasks` |
| サブタスク追加 | POST | `/tasks/{gid}/subtasks` |

## 環境変数

- `ASANA_PERSONAL_ACCESS_TOKEN`: Asanaの個人アクセストークン（必須）
- Base URL: `https://app.asana.com/api/1.0`

## トークン取得

1. Asana アカウント設定 → API トークン
2. 個人アクセストークンを生成
3. `.env` に `ASANA_PERSONAL_ACCESS_TOKEN=...` で保存
4. `.env` を `.gitignore` に追加（git履歴に含めない）

## curl コマンドテンプレート

### ワークスペース確認

```bash
curl -s -X GET "https://app.asana.com/api/1.0/users/me" \
  -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  | jq '.data.workspaces[0].gid'
```

### プロジェクト確認

```bash
WORKSPACE_GID="..."
curl -s -X GET "https://app.asana.com/api/1.0/workspaces/${WORKSPACE_GID}/projects" \
  -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  | jq '.data[] | select(.name=="プロジェクト名") | .gid'
```

### セクション作成

```bash
PROJECT_GID="..."
SECTION_NAME="グループ名"
curl -s -X POST "https://app.asana.com/api/1.0/projects/${PROJECT_GID}/sections" \
  -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"name\":\"${SECTION_NAME}\"}}" \
  | jq '.data.gid'
```

### 親タスク作成

```bash
PROJECT_GID="..."
TASK_NAME="カテゴリ名"
curl -s -X POST "https://app.asana.com/api/1.0/projects/${PROJECT_GID}/tasks" \
  -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"name\":\"${TASK_NAME}\"}}" \
  | jq '.data.gid'
```

### サブタスク作成

```bash
PARENT_TASK_GID="..."
SUBTASK_NAME="タスク名"
curl -s -X POST "https://app.asana.com/api/1.0/tasks/${PARENT_TASK_GID}/subtasks" \
  -H "Authorization: Bearer $ASANA_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"data\":{\"name\":\"${SUBTASK_NAME}\"}}"
```

## トラブルシューティング

| 問題 | 原因 | 解決方法 |
|------|------|---------|
| 401 Unauthorized | トークンが無効 | `.env` のトークンを確認 |
| 404 Not Found | プロジェクトGIDが不正 | プロジェクト確認APIで再確認 |
| セクション重複 | 同名セクション既存 | `GET /sections` で事前チェック実装 |

## セキュリティ注意事項

- トークンは絶対に git に commit しない
- `.env` ファイルは `.gitignore` で除外
- スクリプト内にはトークンを埋め込まない（環境変数から読み込む）
- 実行時ログにトークンが表示されないよう注意

