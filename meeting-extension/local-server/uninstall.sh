#!/usr/bin/env bash
# launchd 登録と plist を取り外す。venv は残す（消したい場合は手動で .venv ディレクトリを削除）。

set -euo pipefail

PLIST_NAME="com.meetingextension.whisper"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

if [ -f "$PLIST_DEST" ]; then
    launchctl bootout "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || true
    rm -f "$PLIST_DEST"
    echo "✓ launchd 登録を解除しました"
else
    echo "(plist は既に無いのでスキップ)"
fi

echo "venv (.venv) は残しています。完全削除したい場合は次を実行してください:"
echo "  rm -rf $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.venv"
