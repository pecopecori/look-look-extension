# Meeting Extension

ブラウザ会議（Google Meet / Zoom Web / Teams / Discord / YouTube 等）のタブ音声と
マイクを同時録音し、文字起こし → 議事録 → タスク抽出 → Google Docs / Calendar /
Sheets 書き込みまでを 1 つの Chrome 拡張で完結させる個人用ツール。

```
   タブ音声  ┐
            ├→ Chrome拡張で録音 → faster-whisper(ローカル) → Gemini(議事録) → Docs/Calendar/Sheets
   マイク   ┘
```

すべての文字起こしは **Mac 内のローカルサーバ** で実行され、外部APIには送られません。

---

## 必要なもの

| 何 | 入手先 | 料金 |
|----|--------|------|
| Mac（Apple Silicon または Intel 16GB以上推奨） | — | — |
| Python 3.10+ | macOS 標準 / `brew install python3` | 無料 |
| Google Cloud OAuth Client ID（Chrome拡張種別） | https://console.cloud.google.com/ | 無料 |
| Gemini API キー | https://aistudio.google.com/apikey | 無料（1日1500req） |

---

## セットアップ（5分）

### 1. faster-whisper ローカルサーバを起動

```sh
cd /Users/demo/開発/meeting-extension/local-server
./install.sh
```

- Python venv を作って `faster-whisper` を入れます
- launchd に登録し、Macログイン時に自動で起動するようにします
- 起動後 `curl http://127.0.0.1:9000/health` で応答確認

初回はモデル（~500MB）をダウンロードするので 1〜2 分かかります。
ログ: `~/Library/Logs/meeting-extension/whisper.log`

停止したいときは `./uninstall.sh`。

### 2. Chrome 拡張を読み込む

1. `chrome://extensions` → 右上「デベロッパーモード」ON
2. 「パッケージ化されていない拡張機能を読み込む」 →
   `/Users/demo/開発/meeting-extension/` を選択
3. 表示された **Extension ID** をコピー（次の手順で使う）

### 3. Google Cloud で OAuth Client ID を発行

1. https://console.cloud.google.com/ でプロジェクトを作成
2. **APIとサービス → ライブラリ** から以下を有効化:
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Calendar API
3. **OAuth同意画面** を「外部」で作成（必要なスコープ:
   drive.file / documents / spreadsheets / calendar.events）
4. **認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - 種別: **Chrome 拡張機能**
   - アプリケーション ID: 手順 2 でコピーした Extension ID
5. 発行された Client ID を `manifest.json` の
   `oauth2.client_id` に貼り付けて保存
6. `chrome://extensions` で拡張機能を「更新」（リロード）

### 4. Gemini API キーを発行

1. https://aistudio.google.com/apikey で「Create API key」
2. キーをコピー

### 5. 拡張機能の設定

1. 拡張アイコン → 「Settings を開く」
2. **Gemini API キー** に貼り付け
3. **「認証して Drive / Sheets を準備」** をクリック → Google 認証 →
   Drive にフォルダ・Ledger Sheets が自動作成される
4. 「保存」

---

## 使い方

1. 会議タブ（Meet / Zoom / YouTube など）をアクティブにする
2. ツールバーの拡張アイコン → 「**録音開始**」
3. タイトル入力（空でもOK）→「この内容で開始」
4. Side Panel が開いて、文字起こしがリアルタイムに流れる
5. 終わったら「**録音停止**」→ 自動で議事録化
6. Side Panel の「**タスク承認**」でタスクを確認 → 「**承認して書き込み**」で
   Google Docs / Calendar / Sheets へ書き出し
7. Report タブで過去会議の一覧と再実行ボタン

---

## ファイル構成

```
meeting-extension/
├── README.md                     ← このファイル
├── manifest.json                 ← MV3 マニフェスト
├── background.js                 ← サービスワーカー（パイプライン本体）
├── offscreen.html / offscreen.js ← 長時間録音用 offscreen ドキュメント
├── popup.html / popup.css / popup.js     ← 拡張アイコンを押すと出るUI
├── sidepanel.html / sidepanel.css / sidepanel.js   ← ライブ文字起こし & 承認
├── settings.html / settings.css / settings.js      ← 設定画面
├── report.html / report.css / report.js  ← 過去会議一覧
├── lib/
│   ├── utils.js     ← 共通ユーティリティ
│   ├── storage.js   ← chrome.storage.local ラッパ
│   └── idb.js       ← IndexedDB（音声チャンク・議事録 JSON）
├── icons/icon{16,48,128}.png
├── local-server/                 ← Mac 上の faster-whisper サーバ
│   ├── whisper_server.py
│   ├── requirements.txt
│   ├── com.meetingextension.whisper.plist
│   ├── install.sh
│   └── uninstall.sh
└── docs/requirements.html        ← 要件定義書
```

---

## トラブルシューティング

| 症状 | 確認ポイント |
|------|--------------|
| 録音開始時 "ローカル whisper サーバに接続できません" | `curl http://127.0.0.1:9000/health` で疎通確認。失敗するなら `tail -f ~/Library/Logs/meeting-extension/whisper.log` |
| 録音開始時 "manifest.json の oauth2.client_id を設定してください" | Google Cloud で発行した Client ID を `manifest.json` に貼り、拡張機能を「更新」 |
| Gemini で `429` | 無料枠（1分15req / 1日1500req）を超えた。少し待つ or 有料プラン |
| 議事録の精度がイマイチ | `local-server/com.meetingextension.whisper.plist` の `--model small` を `medium` に上げると精度UP（処理時間も増える） |
| 文字起こしが遅すぎる | モデルを `base` に下げる、または `--compute int8` で量子化（既定） |

---

## アンインストール

```sh
cd /Users/demo/開発/meeting-extension/local-server
./uninstall.sh           # launchd 登録解除 + plist 削除
rm -rf .venv             # venv も削除する場合
```

Chrome 側は `chrome://extensions` から削除。
chrome.storage.local に残った設定や録音履歴は拡張削除と同時に消えます。
