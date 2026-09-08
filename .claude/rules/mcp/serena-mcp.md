# Serena MCP ツール活用ガイド

## 概要

Serena はコードベースをシンボル単位で操作できるセマンティックコーディングツール。
ファイル全体を読まずに必要な情報だけ取得できるため、コンテキストを節約しつつ精度高く作業できる。

## 必須ルール

> **CRITICAL**: コーディングタスク開始前に必ず `mcp__serena__initial_instructions` を呼ぶこと。

## ツール一覧と使いどころ

### 初期化

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__initial_instructions` | コーディングタスク開始時（**必須**） |
| `mcp__serena__activate_project` | プロジェクトを明示的に切り替える必要があるとき |
| `mcp__serena__onboarding` | プロジェクトの初回セットアップ時 |

### 調査・探索（読み取り系）

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__get_symbols_overview` | ファイル内のシンボル構造を俯瞰する |
| `mcp__serena__find_symbol` | 特定シンボルの定義を探す（`include_body=true` でコード本体も取得） |
| `mcp__serena__find_declaration` | クラス・インターフェースの宣言を探す |
| `mcp__serena__find_implementations` | インターフェースの実装クラスを探す |
| `mcp__serena__find_referencing_symbols` | シンボルの参照箇所を探す（影響範囲の確認） |
| `mcp__serena__find_file` | ファイル名でファイルを探す |
| `mcp__serena__list_dir` | ディレクトリ構造を確認する |
| `mcp__serena__search_for_pattern` | シンボル名が不明な場合のパターン検索 |
| `mcp__serena__read_file` | ファイル全体を読む（最終手段） |
| `mcp__serena__get_diagnostics_for_file` | ファイルの診断情報（コンパイルエラー等）を確認する |

### 編集（書き込み系）

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__replace_symbol_body` | メソッド・クラス全体を置き換える |
| `mcp__serena__insert_after_symbol` | シンボルの直後にコードを追加する |
| `mcp__serena__insert_before_symbol` | シンボルの直前にコードを追加する |
| `mcp__serena__replace_content` | ファイル内の一部（数行）を正規表現で置換する |
| `mcp__serena__rename_symbol` | シンボルをリネームする（参照も一括更新） |
| `mcp__serena__safe_delete_symbol` | シンボルを安全に削除する（参照確認済みのとき） |
| `mcp__serena__create_text_file` | 新規ファイルを作成する |

### メモリ

| ツール | 使いどころ |
|--------|-----------|
| `mcp__serena__list_memories` | 保存済みメモリの一覧を確認する |
| `mcp__serena__read_memory` | 特定のメモリを読む |
| `mcp__serena__write_memory` | メモリを保存する |
| `mcp__serena__edit_memory` | メモリを編集する |
| `mcp__serena__delete_memory` | メモリを削除する |
| `mcp__serena__rename_memory` | メモリをリネームする |

## 使い分けの判断基準

### 調査フロー（情報を取得するとき）

```
1. get_symbols_overview  → ファイル内シンボルの一覧を把握
2. find_symbol (include_body=false) → 目的クラスのメソッド一覧を確認
3. find_symbol (include_body=true)  → 必要なメソッドのコードを読む
   ※ シンボル名が不明なら search_for_pattern で先に探す
   ※ ファイル全体が必要な場合のみ read_file を使う（最終手段）
```

### 編集フロー（コードを変更するとき）

```
メソッド・クラス全体を置き換える  → replace_symbol_body
メソッド内の数行だけ変更する     → replace_content（正規表現で）
新しいメソッドをクラスに追加する  → insert_after_symbol（直前のシンボルの後に）
新規ファイルを作る               → create_text_file
シンボルをリネームする           → rename_symbol（参照も一括更新される）
```

### Serena を使わないケース

- ファイルを単純に新規作成するだけ（`Write` ツールで十分）
- コーディング作業が一切ない（調査・確認のみ）

## 注意事項

- Serena が返す行番号は **0始まり**（1始まりではない）
- `replace_content` は正規表現が使えるため、変更箇所の全文を書かなくてよい
- シンボルの編集結果は Serena ツールがエラーを返さない限り正しいと見なしてよい（再確認不要）
- `find_referencing_symbols` で影響範囲を確認してから編集すると安全
