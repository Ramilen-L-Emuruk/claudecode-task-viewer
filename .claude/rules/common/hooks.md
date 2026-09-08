# フックシステム

## フック種別

- **PreToolUse**: ツール実行前（バリデーション、パラメータ修正）
- **PostToolUse**: ツール実行後（自動フォーマット、チェック）
- **Stop**: セッション終了時（最終検証）

## 自動承認パーミッション

慎重に使用:
- 信頼できる明確な計画に対してのみ有効化
- 探索的な作業では無効化
- dangerously-skip-permissions フラグは使用しない
- 代わりに `settings.json` の `permissions.allow` で個別に指定する

### 手順が確実に叩くものは allow に入れる

手順書が「必ず実施する」「省略しない」と定めた操作が確認待ちで止まるのは、規約と設定の食い違い。次は `settings.json` に登録済み。

- `Task` — 敵対的レビューは全変更で必須。レビューエージェントを起動する唯一の手段
- `EnterWorktree` — ワークツリー作成の Step 2
- `Skill(release)` — リリース手続きの起動口
- `npm test` / `npm run build` — 検証節が名指しする静的な検証
- Playwright の `browser_console_messages` 等 — 「コンソールエラー 0 件を確認」はこれが無いと実行できない

### 引数では絞れない

**許可ルールはツールの引数で条件を付けられない。** コマンド文字列のパターン（`Bash(git merge *)`）・パス指定（`Read(path)`）・属性指定（`WebFetch(domain:...)`）・ツール名のみ、のいずれの形式でも、ツールが受け取るオブジェクト引数のキー単位では分岐できない。`ExitWorktree(action:keep)` のような書き方は効かない。

**末尾の `*` は後続トークンを包含する。** `Bash(git merge *)` があれば `git merge --abort` も通るため、個別に足しても新しい制御にはならない。既存パターンに包含されていないか確認してから追加すること。

### 2 段で足切りする

引数で絞れない以上、判断はツール単位・コマンド単位になる。次の順で当てる。

**第 1 段: 最も危険な呼び出し方が取り返しのつく操作か。** 満たさないものは入れない。

| 対象 | 最悪の呼び出し方 | 判定 |
|---|---|---|
| `EnterWorktree` | `name:` 指定（`CLAUDE.md` が禁じている形）でブランチ名を自動変換されたワークツリーができる。基点は `worktree.baseRef`（Claude Code 本体の設定。既定は `fresh` ＝ `origin/<既定ブランチ>`）が決めるので、古い地点から始まる心配は無い。**消して切り直せる** | 通過 |
| `ExitWorktree` | `action: "remove"` ＋ `discard_changes: true` で、未コミットの変更や未マージのコミットごと消える。**復元手段が無い**。同じ片付けは `git worktree remove`（allow 済み）で足り、そちらは変更が残っていれば git 自身が拒否する | 除外 |
| `Bash(git reset --hard *)` | ローカル専用コミットを失う。`release` スキルが「ユーザー確認を省略しないこと」と定めている | 除外 |

**第 2 段: レビュー専用エージェントが実行する理由があるか。** 無いものは、可逆でも入れない。

`adversarial-reviewer` をはじめレビュー系エージェントは `tools: [Read, Grep, Glob, Bash]` で、Write/Edit を持たない読み取り専用の設計。しかし **`Bash` を持つ以上、allow に入れたコマンドは全部そこから実行できる。** 「修正はしない」はプロンプトの遵守に依存していて、許可設定が裏付けているわけではない。

| 対象 | 判定 |
|---|---|
| `Bash(npm version *)` | **除外。** 個別には可逆（タグ削除・コミット取り消し）だが、レビュアーがバージョンを上げる理由は無い。リリース手続きは必ず叩くコマンドではあるものの、バージョン確認は元から `AskUserQuestion` を挟む規定なので確認が 1 つ増える損は小さい |
| `Bash(npm test)` / `Bash(npm run build)` | 通過。レビュアーが検証のために走らせる筋はある。成果物の生成にとどまり、すぐ終わる |
| `Bash(npm run dev)` / `Bash(npm run preview)` | 通過。レビュアーが呼ぶ理由は無いが、**この 2 つは検証節が「大きめの変更時は必須」と定める操作**で、外すと実装セッションの手順が確認待ちで止まる。原則 1 が優先する。`run_in_background: true` を付けずに呼ぶとハングする点は使い方の規約（`release` スキルに明記）で担保し、許可設定では扱わない |
| `EnterWorktree` / `Task` | 通過。レビュアーが呼んでも読み取り作業の範囲を出ない |
| `Bash(git merge *)` / `Bash(git pull)` | 通過。レビュアーが呼んでも push 前のローカル操作に閉じ、破壊的なフラグを持たない（下記「git が拒否するから安全は成り立たない」でフラグを 1 つずつ確認した） |
| 非破壊のもの（`git status` / `log` / `rev-parse` / `merge-base` / `rev-list` / `branch --list` / `branch --merged` / `branch --show-current` / `tag --points-at` / `fetch`、`gh issue view` / `list`、`ls` / `dir` / `which` / `netstat` / `Test-Path` / `Get-Command` / `Get-ChildItem` / `Get-Job` / `Get-NetTCPConnection`、`WebSearch` / `WebFetch(domain:...)`、Playwright の読み取り系、`context7`） | 通過。どこから呼ばれても取り返しがつく（`git fetch` はリモート追跡ブランチを更新するので厳密には書き込みだが、冪等で再取得すれば整合する） |
| `mcp__serena__write_memory` / `onboarding` | 通過。書き込み先は Serena 自身のメモリストアに閉じ、リポジトリのファイルには触れない |
| `mcp__serena__activate_project` | **要確認のまま通過。** 現在のワークツリー外を対象にできるかを Serena 側の仕様から裏取りできていない。無制限なら別リポジトリへ `write_memory` する経路になるため、判明した時点で再判定する |
| `mcp__playwright__browser_evaluate` | **除外。** ページ上で任意 JavaScript を実行できる。`rules/mcp/playwright-mcp.md` が「任意の JS を実行できるため慎重に」と警告しているのは `browser_run_code_unsafe` だが、危険度は同等。`browser_navigate` に接続先の制限が無いため、外部ドメインのコンテキストで任意コードが動く |
| `mcp__Claude_in_Chrome__computer` / `navigate` | **除外。** Playwright の隔離インスタンスと違い、**ログイン済みの実 Chrome** をマウス・キーボードで操作する。フォーム送信・購入・メール送信といった実世界に不可逆な副作用に到達しうる。閲覧に留まる `tabs_context_mcp` だけ残した |
| `Read(//tmp/**)` → `Read(//tmp/claude/**)` へ | この環境の `/tmp` は `C:/Users/<user>/AppData/Local/Temp` に解決される。**Windows のユーザー Temp フォルダ全体**が読めており、他アプリの一時ファイル（インストールログ・ブラウザのダウンロード等）まで対象だった。スクラッチパッドの親（`claude/`）へ絞った |

`AskUserQuestion` は確認そのものなので許可の対象外。`defaultMode` を `auto` にしている場合、`Read` / `Edit` / `Write` / `Grep` / `Glob` の個別指定は不要。

### 既存エントリにも当て直す

**基準は新規追加のときだけ使うものではない。** 上の 2 段を既存の allow 全体に当て直したところ、次が通らなかった。

| 削除したもの | 理由 |
|---|---|
| `Bash(git checkout *)` | `git checkout -- <file>` が未コミットの変更を復元不能に破棄する。**手順書はどこでも `git checkout` を使っていない**（言及は「危険」「ワークツリー内では失敗する」という注意書きのみ）ので、消しても手順は成立する |
| `Bash(git push)` / `git push origin *` / `git push --tags` / `git push --follow-tags` / `git push -u origin *` | push は取り消せず、CI 経由で本番へ出る**外向きの操作**。第 1 段を通らない。加えてレビュー専用エージェントが push する理由は無く第 2 段も通らない。手順が使うのは `git push --follow-tags` 1 つだけで、その直前に `AskUserQuestion` での承認が既に入っているため、**確認が 1 回増える代償は小さい** |
| `Bash(git add *)` / `Bash(git commit *)` / `Bash(git commit -m ' *)` | git 履歴に内容を書き込む。レビュー専用エージェントは「修正はしない。変更をコミットしない」と定義されているのに、`Bash` を持つ以上この 2 つで実行できていた（第 2 段を通らない）。コミット前確認（手順 8）が既に `AskUserQuestion` の承認を課しているため、確認の重複にとどまる |
| `Bash(git tag *)` → `git tag --points-at *` へ | `git tag -d` がタグを消し、`git tag <name>` が新しいタグを作る。手順が使う読み取り形式は `--points-at HEAD` だけなのでそこへ絞った（タグ作成はバージョン更新コマンドが行い、そこは確認を挟む） |
| `PowerShell(git *)` | git の全サブコマンドを素通しにする。これがあると上の `Bash(git ...)` の絞り込みは無意味で、`git reset --hard` も `git push origin main` も PowerShell 経由で通っていた |
| `Bash(powershell.exe *)` | **別のシェルを起動するパターン。** `powershell.exe -Command "git push origin main --force"` はコマンド文字列が `powershell.exe ` で始まるだけでマッチするため、git に限らず**あらゆる制限を迂回できた**。上の絞り込みを全部無効化していた |
| `Bash(fd *)` / `Bash(rg *)` | **フラグ経由でコマンドを実行できる。** `fd -x <cmd>` はヒットごとに任意コマンドを走らせ、`rg --pre <cmd>` は各ファイルを外部コマンドの出力に差し替える。許可判定はフラグを解析しないため、これらは任意コード実行と等価。検索は `Grep` / `Glob` ツールで足りる |
| `Bash(xargs grep:*)` | `xargs` は後続コマンドを実行する。`grep` 固定なら実行ベクタは無いと評価されたが、確証が取れないため予防的に外した |
| `PowerShell(Stop-Process *)` | `-Force` で任意のプロセス名・PID を強制終了できる。**`CLAUDE.md` が「`Stop-Process -Name node` のような一括停止は使わない」と名指しで禁じている操作**が、無確認で通っていた。未保存の作業を失うため第 1 段も通らない |
| `PowerShell(New-Item *)` | `-Force` で既存ファイルを上書きする。git 管理外のファイルなら復元手段が無い。ファイル作成は `Write` ツールで足りる |
| `Bash(gh issue *)` → `gh issue view *` / `gh issue list *` へ | `gh issue create` / `close` / `comment` / `edit` / `delete` が通っていた。**他者から見える外向きの書き込み**で、第 1 段・第 2 段のどちらも通らない。読み取りの 2 形式へ絞った |

### 「git が拒否するから安全」は成り立たない

かつてここには「`git branch -d` は未マージのブランチを消さない」「`git worktree remove` は変更が残っていれば拒否する」ことを根拠に、これらを allow へ残すと書いてあった。**実際に動かして確認したところ、いずれも誤りだった。**

```
git branch -d testbranch            # 未マージ → 拒否
git branch -d --force testbranch    # 通る。-D を書く必要は無い
git worktree remove <path>           # 未追跡ファイルあり → 拒否
git worktree remove --force <path>   # 通る。ディレクトリごと消える
git worktree add -B <既存ブランチ> <path>   # force なしで既存ブランチを巻き戻す
```

git の安全装置はフラグ 1 つで外れる。そして**許可判定はフラグを解析しない**（この節の冒頭）。

**パターンを狭めても防げない。** git はフラグを後置でも受け付けるため、`Bash(git branch -d ready/*)` のように絞っても `git branch -d ready/x --force` はプレフィックスに一致して通る。

したがって次の 4 つは allow から外した——`git branch -d *` / `git branch -m *` / `git worktree add *` / `git worktree remove *`。加えて `git pull *` も、`-f, --force overwrite of local branch` を持つため外した（引数なしの `git pull` だけ残した）。

`git merge *` は残す。`git merge -h` に破壊的なフラグは無く（`--abort` は復元操作）、汚れた作業ツリーで上書きが起きる場合は git が実行前に止める。**この判断は「フラグを 1 つずつ確認した」ことに基づく**——コマンド名の印象ではない。

### 結論: allow に入れられる条件

**どんなフラグを付けても取り返しがつくコマンドだけ。** フラグ次第で破壊的になるものは、パターンをどう狭めても後置フラグで迂回されるため入れられない。

残っているのは実質、読み取り専用の調査コマンドと、検証・レビューの道具立てだけになる。手順のうち状態を変える段（コミット・改名・削除・マージ・push）は**どれも既に `AskUserQuestion` の承認を課している**ので、許可プロンプトが増えても確認が二重になるだけで手順は止まらない。

**読み取り専用に見えるコマンドでも、フラグを確認すること。** `git log --output=<file>` は任意ファイルを上書きし、`git fetch . <commit>:refs/heads/<branch> --force` はローカルブランチを巻き戻す。どちらも実際に動かして確認した。名前が `log` や `fetch` でも、書き込みフラグを持っていれば allow には入れられない。

### 残存リスク（意図的に受容しているもの）

この設定は**フラグ単位で完全に安全ではない**。`Bash(<コマンド> *)` という形式は前方一致なので、後置フラグを排除する手段が原理的に無い。完全一致だけで組み直せば健全になるが、調査系コマンドがほぼ全部確認待ちになり実用性を失う。そのため次を**既知のトレードオフとして受容している**。

| 受容しているリスク | 内容 |
|---|---|
| **Playwright の操作系**（`click` / `type` / `fill_form` / `press_key`） | `browser_navigate` に接続先の制限が無いため、`navigate` → `snapshot` → `fill_form` → `click` の連鎖で外部ドメインのフォームへ送信できる。`WebFetch(domain:...)` のドメイン制限を迂回する経路になる。**ブラウザでの動作確認は検証節が必須と定める手段**のため残している |
| **`npm test` / `npm run build` / `npm run dev` / `npm run preview`** | 実体は配布先の `package.json` の `scripts` であり、**テンプレート側では中身を検証できない**。これらを allow に置くことは「配布先のスクリプト定義を信頼する」という宣言にあたる |
| **`Read(//tmp/claude/**)`** | この端末上の全プロジェクト・全セッションのスクラッチパッドを横断できる。セッション ID は実行時に決まるため、パターンでは絞れない |
| **`Bash(git <サブコマンド> *)` 形式全般** | `git merge *` 等に残る。`--autostash` のように「git が止めてくれる」前提を崩すフラグが今後見つかる可能性がある |

**除外した `PowerShell(Stop-Process *)` は非対称な扱いになっている。** セッション終了時のサーバー停止は検証節が定める定型作業なのに、その手前に承認ゲートが無い——原則 1 に照らせば allow に入るべきだが、`-Force` で任意プロセスを強制終了できるため外した。`npm run dev` に与えた「原則 1 が優先する」の救済をここには与えていない。**判断が割れる論点として記録しておく。**

### この設計を見直すとき

**フラグを 1 つずつ潰す方式は終わらない。** この設定を詰めた作業では、危険フラグを塞ぐたびに未検証の別コマンドの危険フラグが見つかる、という状態が 6 巡続いた（`powershell.exe` → `fd -x` / `rg --pre` → `branch -d --force` / `worktree remove --force` / `worktree add -B` → `git log --output` / `git fetch <refspec> --force`）。git のサブコマンドが持つオプション数を考えれば、この方式に終わりは無い。

健全にしたいなら、**`Bash(<コマンド> *)` のワイルドカード形式をやめ、手順が実際に叩く呼び出しだけを引数固定の完全一致で列挙する**方式へ転換する。allow は大幅に縮み、調査系コマンドの多くが確認待ちになる代わりに、フラグによる迂回が原理的に無くなる。**上の残存リスク表は、その転換をしていないことの帰結。**

`ask` の force push パターンは残す。いま push が allow に無いのでどれも確認は挟まるが、将来 push を allow へ戻す変更が入ったときに「force は別扱い」という意図が残る。

### 絞り込む前に、脱出口を塞ぐ

**サブコマンド単位で丁寧に絞っても、脱出口が 1 つあれば全部素通りする。** 今回の作業では `Bash(git ...)` を 3 巡かけて絞り込んだあとに `Bash(powershell.exe *)` が残っているのが見つかり、それまでの絞り込みが実効性を持っていなかった。

allow を絞るときは、**先に次の 3 種類が無いかを確認する**。

- **別のシェル・ランタイムを起動するパターン** — `Bash(powershell.exe *)`・`Bash(bash *)`・`Bash(sh *)`・`Bash(python *)` 等。中で何でも実行できるため、他のあらゆる制限を迂回する
- **フラグ経由でコマンドを実行できるパターン** — `Bash(fd *)`（`-x`）・`Bash(rg *)`（`--pre`）・`Bash(find *)`（`-exec`）・`Bash(xargs *)` 等。**許可判定はフラグを解析しない**ため、コマンド名が安全でも実行ベクタを持つオプションごと通る
- **ビルドツールの設定上書きオプション** — `cargo --config`・`git -c`・`mvn -Dexec.executable` のように、**サブコマンドを問わず効くグローバルオプションで外部コマンドを差し替えられる**もの。`cargo test --config "target.<triple>.runner=['cmd','/c','...']"` と `cargo build --config "build.rustc-wrapper='cmd'"` は、実際に任意コマンドの実行を確認した。「ビルドやテストは元からプロジェクトのコードを走らせるのだから限界リスクは小さい」という理屈は成り立たない——**プロジェクトのコードを 1 行も通さずに実行できる**
- **同じコマンドを丸ごと許すパターン** — `PowerShell(git *)` のように「あるコマンド全部」を許すもの。サブコマンド単位の絞り込みを飲み込む

`Bash(...)` と `PowerShell(...)` は**別々に評価される**。片方だけ絞っても、もう片方に同じコマンドの包括パターンが残っていれば意味が無い。

**コマンド名を見て安全だと判断しない。** そのコマンドが「引数として与えた別のコマンドを実行できるか」「既存の何かを上書き・削除できるか」を、`--help` で確認してから許可すること。**グローバルオプションはサブコマンド側の `--help` に出ないことがある**ので、`<コマンド> --help` も併せて読むこと。

**言語ツールチェーンは `Bash(<ツール> <サブコマンド> *)` の形で allow に入れない。** cargo / npm / mvn / gradle 等は設定を上書きするグローバルオプションを持ち、末尾 `*` はそれを包含する。手順が実際に叩く呼び出しを**完全一致で列挙する**こと（例: `Bash(cargo build)` `Bash(cargo test)` `Bash(cargo clippy -- -D warnings)`）。引数が必要なもの（`cargo add <pkg>`・`npm install <pkg>`）は、依存を増やす操作でもあるため確認を挟む。

> **ワークツリー内では Bash の複合コマンドが拒否される。** `for` ループやパイプを多段に連ねた命令は「ワークツリー内に留まると検証できない」として実行されない。許可設定とは別の制約なので、ワークツリー内では単純なコマンドに分けること。

## 進捗管理ツールのベストプラクティス

> ツール名は環境によって違う（`TodoWrite` の環境もあれば、`TaskCreate` / `TaskUpdate` / `TaskList` の
> 環境もある）。**いつ使うか・何を記録するかは [work-memory.md](./work-memory.md) を正とする。**
> ここに書くのは、どの道具でも変わらない使いどころ。

進捗管理ツールの活用:
- マルチステップタスクの進捗追跡
- 指示理解の確認
- リアルタイムのステアリング
- 詳細な実装ステップの表示

進捗リストで判明すること:
- 順序の誤り
- 抜け漏れ
- 不要な余分な項目
- 粒度の誤り
- 要件の誤解
