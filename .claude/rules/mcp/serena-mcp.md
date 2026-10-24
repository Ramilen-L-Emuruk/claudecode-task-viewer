# Serena MCP ツール活用ガイド

## 概要

Serena はコードベースをシンボル単位で操作できるセマンティックコーディングツール。
ファイル全体を読まずに必要な情報だけ取得できるため、コンテキストを節約しつつ精度高く作業できる。

## 必須ルール

> **CRITICAL**: コーディングタスク開始前に必ず `mcp__serena__initial_instructions` を呼ぶこと。

## 前提: `claude-code` コンテキストでは一部ツールが提供されない

このガイドは `--context=claude-code` での起動を前提にする。この設定では**組み込みツールと重複する機能を Serena 側が意図的に提供しない**。具体的には `read_file` / `list_dir` / `find_file` / `search_for_pattern` / `create_text_file` / `execute_shell_command` が存在しない。

これらの用途は組み込みツールで代替する。

| やりたいこと | 使うツール |
|-------------|-----------|
| ファイル全体を読む | `Read` |
| ファイル名で探す | `Glob` |
| 内容をパターン検索する | `Grep` |
| ディレクトリ構造を見る | `Glob` または `Bash(ls)` |
| 新規ファイルを作る | `Write` |

> Serena にこれらのツールがないのは不具合ではない。組み込みツールを使うこと。

## ツール一覧と使いどころ

以下は **起動時に対象プロジェクトが決まっている場合**の一覧。決まらないまま起動すると、これに次の 2 つが加わる。

| 追加で現れるツール | 用途 |
|--------|-----------|
| `mcp__serena__activate_project` | 対象プロジェクトを切り替える |
| `mcp__serena__get_current_config` | 有効なプロジェクト・モード・ツール構成を確認する |

`--project-from-cwd` で起動した場合、対象プロジェクトは **cwd から親をさかのぼって `.git` か `.serena/project.yml` を探して決まる**。**そのどこにも見つからなければ決まらない**ので、git 管理外の作業場などでは上の 2 つが現れる。**見分けるには一覧に `activate_project` があるかを見ればよい。**（`--project <パス>` で明示して起動した場合は、最初からそのプロジェクトが有効になる）

なお `check_onboarding_performed` は、下の一覧に無いのではなく **Serena 1.7.0 時点で削除済み**（確認した版での話。起動条件によらず存在しない）。

### 初期化

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__initial_instructions` | コーディングタスク開始時（**必須**） |
| `mcp__serena__onboarding` | プロジェクトの初回セットアップ時 |

### 調査・探索（読み取り系）

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__get_symbols_overview` | ファイル内のシンボル構造を俯瞰する |
| `mcp__serena__find_symbol` | 特定シンボルの定義を探す（`include_body=true` でコード本体も取得） |
| `mcp__serena__find_declaration` | クラス・インターフェースの宣言を探す |
| `mcp__serena__find_implementations` | インターフェースの実装クラスを探す |
| `mcp__serena__find_referencing_symbols` | シンボルの参照箇所を探す（影響範囲の確認） |
| `mcp__serena__get_diagnostics_for_file` | ファイルの診断情報（コンパイルエラー等）を確認する |

### 編集（書き込み系）

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__replace_symbol_body` | メソッド・クラス全体を置き換える |
| `mcp__serena__insert_after_symbol` | シンボルの直後にコードを追加する |
| `mcp__serena__insert_before_symbol` | シンボルの直前にコードを追加する |
| `mcp__serena__replace_content` | ファイル内の一部（数行）を正規表現で置換する |
| `mcp__serena__replace_in_files` | 複数ファイルを横断して一括置換する |
| `mcp__serena__rename_symbol` | シンボルをリネームする（参照も一括更新） |
| `mcp__serena__safe_delete_symbol` | シンボルを安全に削除する（参照確認済みのとき） |

### メモリ

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__list_memories` | 保存済みメモリの一覧を確認する |
| `mcp__serena__read_memory` | 特定のメモリを読む |
| `mcp__serena__write_memory` | メモリを保存する |
| `mcp__serena__edit_memory` | メモリを編集する |
| `mcp__serena__delete_memory` | メモリを削除する |
| `mcp__serena__rename_memory` | メモリをリネームする |

> **注意**: Serena のメモリは、Claude Code 自身が持つファイルベースのメモリとは**別の保管場所**（既定で `<プロジェクト>/.serena/memories`）になる。記録先が二系統に割れるため、どちらに書くかを意識して使い分けること。

## 使い分けの判断基準

### 調査フロー（情報を取得するとき）

```
1. get_symbols_overview  → ファイル内シンボルの一覧を把握
2. find_symbol (include_body=false) → 目的クラスのメソッド一覧を確認
3. find_symbol (include_body=true)  → 必要なメソッドのコードを読む
   ※ シンボル名が不明なら Grep で先に探す
   ※ ファイル全体が必要な場合のみ Read を使う（最終手段）
```

### 編集フロー（コードを変更するとき）

```
メソッド・クラス全体を置き換える  → replace_symbol_body
メソッド内の数行だけ変更する     → replace_content（正規表現で）
複数ファイルを横断して置換する    → replace_in_files
新しいメソッドをクラスに追加する  → insert_after_symbol（直前のシンボルの後に）
シンボルをリネームする           → rename_symbol（参照も一括更新される）
新規ファイルを作る               → Write（組み込みツール）
```

### Serena を使わないケース

- ファイルを単純に新規作成するだけ（`Write` ツールで十分）
- コーディング作業が一切ない（調査・確認のみ）

## 注意事項

- Serena が返す行番号は **0始まり**（1始まりではない）
- `replace_content` は正規表現が使えるため、変更箇所の全文を書かなくてよい
- シンボルの編集結果は Serena ツールがエラーを返さない限り正しいと見なしてよい（再確認不要）
- `find_referencing_symbols` で影響範囲を確認してから編集すると安全
- **ツール構成は `--context`・起動オプション・Serena のバージョンで変わる。上の一覧を固定の事実として扱わないこと。** **Claude Code が示すツール一覧を正とする**——そこに無い名前が上の表にあれば、この文書のほうが古いか、起動条件が違う
- 許可設定（`permissions.allow`）での扱いは `rules/common/hooks.md` を参照
