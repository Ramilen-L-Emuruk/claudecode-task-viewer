# ファイル出力パス規約

## 概要

実行ログ・スクリーンショットなどの一時出力ファイルは、プロジェクトルートに散乱させず `.claude/` 配下の指定ディレクトリに保存すること。

## 保存先ディレクトリ

| ファイル種別 | 保存先 | 例 |
|-------------|--------|-----|
| スクリーンショット（PNG/JPG） | `.claude/screenshots/` | `.claude/screenshots/screen-initial.png` |
| アプリ実行ログ | `.claude/logs/` | `.claude/logs/web-server.log` |

## アプリ起動時のログリダイレクト

アプリを起動する際は、標準出力・標準エラーを `.claude/logs/` 配下のファイルにリダイレクトしてバックグラウンドで起動すること。具体的な起動コマンドはプロジェクトのビルドツール・フレームワークに依存する。

## Playwright スクリーンショット

Playwright でスクリーンショットを取得する際は、保存先に `.claude/screenshots/` を指定すること。

```bash
# agent-browser
agent-browser screenshot .claude/screenshots/画面名.png

# mcp__playwright__browser_take_screenshot
# path パラメータに .claude/screenshots/画面名.png を指定
```

## Git 管理

`.claude/screenshots/` と `.claude/logs/` は `.gitignore` に追加して Git 管理対象外にすること（一時ファイルのため）。
