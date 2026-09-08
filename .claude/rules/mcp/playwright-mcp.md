# Playwright MCP ツール活用ガイド

## 概要

Playwright MCP はブラウザを操作して**動作確認・E2E テスト**を行うツール。
コードを変更したら、ビルドだけでなく必ずブラウザでの動作確認まで行う。

> **`preview_start` / `preview_*` ツール（Claude Preview MCP）は使用しない。** ブラウザ確認は必ず Playwright MCP で行う。

## 使うべきタイミング

以下に該当する場合は Playwright MCP でブラウザ確認を実施する:

- コードを修正した後の動作確認（ビルド成功だけで完了とみなさない）
- 画面遷移・フォーム送信・ボタン操作など UI に影響する変更
- 重要なユーザーフローの検証（ログイン・業務画面操作等）

## 使わないケース

- ビルド・コンパイルエラーの解消（ブラウザ確認は不要）
- ロジックのリファクタリングで UI への影響がない変更（ユニットテストで確認）
- サーバーが起動していない状態

## ツール一覧

| ツール | 役割 |
|--------|------|
| `browser_navigate` | URL に移動する |
| `browser_snapshot` | 現在のページ構造（アクセシビリティツリー）を取得する |
| `browser_take_screenshot` | スクリーンショットを撮る |
| `browser_click` | 要素をクリックする |
| `browser_type` | テキストを入力する |
| `browser_fill_form` | フォームを一括入力する |
| `browser_select_option` | セレクトボックスを選択する |
| `browser_press_key` | キーを押す（Enter・Tab・F5 等） |
| `browser_find` | 要素を探す |
| `browser_wait_for` | 条件が満たされるまで待機する |
| `browser_hover` | 要素にホバーする |
| `browser_navigate_back` | 前のページに戻る |
| `browser_console_messages` | コンソールメッセージを取得する（エラー確認） |
| `browser_network_requests` | ネットワークリクエストの一覧を取得する |
| `browser_tabs` | 開いているタブ一覧を取得・切り替える |
| `browser_resize` | ウィンドウサイズを変更する |
| `browser_close` | ブラウザを閉じる |

## 使用フロー

```
Step 1: アプリを起動する（起動済みなら不要）

Step 2: browser_navigate で対象画面に移動する

Step 3: browser_snapshot または browser_take_screenshot で現在の状態を確認する

Step 4: 操作（click / type / fill_form / press_key 等）

Step 5: browser_snapshot / browser_take_screenshot で操作後の状態を確認する

Step 6: browser_console_messages でエラーが出ていないか確認する

Step 7: 正常に動作していることを確認したら完了
```

## スクリーンショットの保存先

スクリーンショットは `.claude/screenshots/` に保存する:

```
browser_take_screenshot → path: ".claude/screenshots/画面名.png"
```

## 注意事項

- `browser_run_code_unsafe` は任意の JS を実行できるため、慎重に使用すること
- スクリーンショットは Git 管理対象外（`.gitignore` に追加済みであること）
- 動作確認が終わったら、起動したサーバーを停止することを忘れない
