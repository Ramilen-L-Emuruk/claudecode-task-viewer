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

**バックグラウンドで起こす常駐プロセスには、パイプを付けない。** 起動ログを見たくて `| head -20` や `| tail` を付けると、パイプの先が読み終えて閉じた時点で、上流のサーバーが SIGPIPE や EPIPE（書き込み先が閉じた）で落ちる。**完了の通知は「exit code 0」で来る**ので正常終了に見え、ポートを叩くまで落ちたことに気づけない。

```bash
npm run dev 2>&1 | head -20                    # head が終わった時点でサーバーも止まる
npm run dev > .claude/logs/dev.log 2>&1         # これなら動き続ける
```

ログはファイルへ落とし、後から読む。実ポートもそのログ（Vite なら `Local:` の行）で確かめる。

## Playwright スクリーンショット

Playwright でスクリーンショットを取得する際は、保存先に `.claude/screenshots/` を指定すること。

```bash
# agent-browser
agent-browser screenshot .claude/screenshots/画面名.png

# mcp__playwright__browser_take_screenshot
# filename パラメータに .claude/screenshots/画面名.png を指定
```

### ワークツリーで作業していても、保存先はメインの checkout になる

**Playwright MCP に渡した相対パスは、作業中のワークツリーではなく、メインの checkout を基準に解決される**
（ワークツリーの中で dev サーバーを起動して検証していても変わらなかった。なぜそちらが基準になるかは確かめていない）。

- `.claude/screenshots/画面名.png` と指定すると、**メイン側の** `.claude/screenshots/` へ出る
- ファイル名だけを指定すると、**メインの checkout の直下に未追跡ファイルとして散る**
- 読むときは `Read` へメイン側の絶対パスを渡す。ワークツリー側を探しても無い
- MCP は同じ場所へ `.playwright-mcp/`（スナップショット・コンソールのログ）も作る。これも一時出力なので
  `.gitignore` の対象にする

**後片付けで消すのはメイン側。** ワークツリーの `git status` には現れないので、そちらだけ見て
「きれい」と判断すると残る。

## Git 管理

`.claude/screenshots/` と `.claude/logs/` は `.gitignore` に追加して Git 管理対象外にすること（一時ファイルのため）。
