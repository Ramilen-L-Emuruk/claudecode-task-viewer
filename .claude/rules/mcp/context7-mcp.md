# Context7 MCP ツール活用ガイド

## 概要

Context7 はライブラリ・フレームワークの**最新ドキュメントとコードサンプル**をリアルタイムで取得するツール。
学習データのカットオフに依存せず、常に公式ドキュメントの現在の情報を参照できる。

## 使うべきタイミング

以下に該当する場合は **必ず** Context7 を使う（自分の知識で答えるな）:

- ライブラリ・フレームワークの API 構文・設定方法を確認するとき
- バージョンアップによる破壊的変更・移行ガイドが必要なとき
- ライブラリ固有のデバッグ・エラー解決
- セットアップ手順・CLI ツールの使い方
- コードサンプルが欲しいとき

**対象の例**: Spring Boot, Spring Framework, Jakarta EE, Maven, JUnit 5, Mockito, React, Next.js, Prisma, Tailwind, Django など、あらゆるライブラリ・フレームワーク・SDK・クラウドサービス

> よく知っているライブラリでも使うこと。学習データが古い可能性がある。

## 使わないケース

- リファクタリング・コードレビュー（ドキュメント参照不要）
- ゼロからのスクリプト作成
- ビジネスロジックのデバッグ
- 一般的なプログラミング概念の説明

## ツール一覧

| ツール | 役割 |
|--------|------|
| `mcp__context7__resolve-library-id` | ライブラリ名 → Context7 の library ID に解決（**必ず最初に呼ぶ**） |
| `mcp__context7__query-docs` | library ID を使ってドキュメント・コードサンプルを取得 |

## 使用フロー

```
Step 1: resolve-library-id でライブラリ ID を取得
  - libraryName: 公式名称を使う（例: "Spring Boot" not "springboot"）
  - query: 調べたいこと（具体的に書く）

Step 2: query-docs でドキュメントを取得
  - libraryId: Step 1 で得た ID を使う
  - query: 具体的な質問（"How to configure X" 等）
```

## ライブラリ ID の選び方（resolve-library-id の結果から）

結果が複数返る場合、以下の優先順位で選ぶ:

1. **名前の一致度** — クエリと完全一致・部分一致するもの
2. **Source Reputation** — `High` > `Medium` > `Low`
3. **Code Snippets 数** — 多いほど実用的な情報が豊富
4. **Benchmark Score** — 100 が最高

## 注意事項

- **1 質問につき各ツール最大 3 回まで**。3 回以内で見つからなければ最善の結果を使う
- クエリに API キー・パスワード・個人情報・独自コードを含めない
- バージョン指定が必要な場合は `/org/project/version` 形式の ID を使う
  - 例: `/spring-projects/spring-boot/v3.3.0`
- ユーザーが `/org/project` 形式で library ID を直接指定した場合は `resolve-library-id` をスキップして `query-docs` を直接呼ぶ
