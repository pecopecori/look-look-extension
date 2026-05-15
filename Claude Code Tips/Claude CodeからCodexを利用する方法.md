# Claude CodeからCodexを利用する方法・メリットまで完全解説

> 出典：スモビジ開発ラボ (@yoshio_nocode)  
> 投稿日：2026年4月3日

---

## 概要

Claude CodeとCodexは「どちらが優れているか」という比較ではなく、**それぞれの強みを活かして使い分ける**のが最適解。  
2026年3月に公開された「Codex Plugin for Claude Code」で、Claude Codeの環境からCodexをシームレスに呼び出せるようになった。

---

## 設計思想・アプローチの根本的な違い

| | Claude Code | Codex |
|---|---|---|
| イメージ | 優秀なエンジニア1人 | トップダウンの工場型 |
| 思想 | Human-in-the-loop（人間と対話しながら進める） | 深く長く考えて完遂を目指す |
| 強み | 計画が定まっていない「走りながら考える」タスク | 定型処理・API連携・細部の複雑な実装 |

**よく言われる例え：**
- Codex：「頭がいいけど手が遅い」
- Claude Code：「手が早いけど言わないと動かない」

**初期印象：** 「Claude Codeは快適、Codexは信頼できる」

---

## セットアップ手順

### 1. Codex CLI本体のインストール

```bash
# npmを使用する場合（Windows/Mac/Linux共通）
npm install -g @openai/codex

# Homebrewを使用する場合（Macのみ）
brew install --cask codex
```

### 2. Claude Codeへのプラグイン追加

```bash
# プラグインの追加とインストール
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex

# pluginをリロード
/reload-plugins

# セットアップの実行
/codex:setup
```

> 公式GitHub：https://github.com/openai/codex-plugin-cc

---

## 主要コマンド一覧

| コマンド | 説明 | 用途 |
|---|---|---|
| `/codex:review` | 標準的な読み取り専用レビュー | 作業のデフォルトの二次確認 |
| `/codex:adversarial-review` | 敵対的レビュー（前提・ロジックに疑問を投げかける） | 実装の前提条件やロジックを厳しく検証したいとき |
| `/codex:rescue` | タスクを直接Codexに引き渡す | スレッドが行き詰まったとき・Codexの完遂力が必要なとき |

---

## 非エンジニア向け活用法：カスタムSkillでCodexを資料レビューに使う

### 問題
`/codex:review` はコードレビュー専用設計のため、企画書・ビジネスプラン・マーケティング資料などの**非コードコンテンツには直接使えない**。

### 解決策
`/codex:rescue`（汎用タスクをCodexに委譲できるコマンド）を組み込んだ**Claude CodeのSkillを作成**することで、Codexの「厳密な論理検証・矛盾検出能力」を非エンジニア業務にも転用できる。

**実績例：** 契約書作成 → Codexでレビュー → 11分間の自律レビューで高品質な結果を返した。

### Skillを作るプロンプト

```
{やりたいこと} をCodexにやらせるSkillを作って。
/codex:rescue の thin forwarder パターンで。
```

**応用できる業務例：**
- 契約書・規約のレビュー（条項間の矛盾・抜け漏れ・リスク検出）
- 企画書・ビジネスプランの論理チェック
- マーケティング資料の検証
- その他、厳密な論理一貫性チェックが必要なあらゆる文書

---

## Claude Code + Codex の組み合わせメリット

- 1つのAIでは見落としがちな盲点を別のAIが補う**「相互チェック体制」**
- 設計・レビュー と 実装・検証 を役割分担させることで、**精度と速度が大幅向上**
- さらにAntigravityやCursorなどのIDEエディタと組み合わせると、より強力な開発環境を構築できる

> **2026年は「使い分け」の時代。**  
> Claude CodeとCodexは競合ではなく、互いの弱点を補い合う完璧なパートナー。
