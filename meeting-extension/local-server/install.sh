#!/usr/bin/env bash
#
# Meeting Extension faster-whisper サーバの初期セットアップ。
#
# 役割:
#   1. Python venv を作って faster-whisper を入れる
#   2. launchd 用 plist を ~/Library/LaunchAgents/ に配置
#   3. launchctl で起動・自動ログイン時起動を有効化
#
# 使い方:
#   $ cd /Users/demo/開発/meeting-extension/local-server
#   $ ./install.sh
#
# 動作確認:
#   $ curl http://127.0.0.1:9000/health
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PLIST_NAME="com.meetingextension.whisper"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOG_DIR="$HOME/Library/Logs/meeting-extension"
SERVER_SCRIPT="$SCRIPT_DIR/whisper_server.py"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
blue()  { printf "\033[34m%s\033[0m\n" "$*"; }

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        red "✗ $1 が見つかりません。先にインストールしてください。"
        exit 1
    fi
}

# 1. 依存チェック
blue "== 依存ツールを確認 =="
require_cmd python3
require_cmd curl

PY_VERSION=$(python3 -c 'import sys; print(".".join(str(x) for x in sys.version_info[:2]))')
green "✓ python3 ($PY_VERSION) が見つかりました"

# 2. venv 作成
blue "== Python venv を作成 =="
if [ -d "$VENV_DIR" ]; then
    green "✓ venv は既にあります: $VENV_DIR"
else
    python3 -m venv "$VENV_DIR"
    green "✓ venv を作成しました: $VENV_DIR"
fi

# 3. 依存パッケージ
blue "== 依存パッケージをインストール =="
"$VENV_DIR/bin/pip" install --upgrade pip wheel >/dev/null
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"
green "✓ パッケージインストール完了"

# 4. ログディレクトリ
mkdir -p "$LOG_DIR"
green "✓ ログ出力先: $LOG_DIR"

# 5. plist を実パスで差し替え
blue "== launchd plist を配置 =="
mkdir -p "$HOME/Library/LaunchAgents"

if [ ! -f "$PLIST_SRC" ]; then
    red "✗ $PLIST_SRC が見つかりません"
    exit 1
fi

# プレースホルダ置換
sed \
    -e "s|__VENV_DIR__|$VENV_DIR|g" \
    -e "s|__SCRIPT_PATH__|$SERVER_SCRIPT|g" \
    -e "s|__SCRIPT_DIR__|$SCRIPT_DIR|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$PLIST_SRC" > "$PLIST_DEST"
green "✓ plist を配置: $PLIST_DEST"

# 6. launchd で読み込み（既存があれば外してから）
blue "== launchd で起動 =="
launchctl bootout "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
launchctl enable "gui/$(id -u)/$PLIST_NAME"
launchctl kickstart -k "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true
green "✓ launchd 登録完了。Mac ログイン時に自動起動します"

# 7. 起動確認
blue "== サーバ起動を待機 =="
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:9000/health >/dev/null 2>&1; then
        green "✓ サーバが応答しました ($(curl -s http://127.0.0.1:9000/health))"
        echo
        green "セットアップ完了！"
        echo
        echo "停止: launchctl bootout gui/\$(id -u) $PLIST_DEST"
        echo "ログ: $LOG_DIR/whisper.log"
        exit 0
    fi
    printf "."
    sleep 2
done

echo
red "⚠ 30秒以内に health に応答しませんでした。初回はモデルダウンロード(~500MB)で時間がかかります。"
echo "ログを確認: tail -f $LOG_DIR/whisper.log"
exit 0
