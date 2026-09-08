# 共通パターン

## 設計パターン

### テンプレートメソッドパターン

抽象基底クラスでアルゴリズムの骨格を定義し、サブクラスで具体的な処理を実装:

```java
// 抽象基底クラス
public abstract class AbstractProcessor {
    public final void process(Request request) {
        preProcess(request);
        doProcess(request);      // サブクラスが実装
        postProcess(request);
    }
    protected abstract void doProcess(Request request);
}
```

### リポジトリパターン

データアクセスを一貫したインターフェースの背後にカプセル化:
- 標準操作を定義: findAll, findById, create, update, delete
- 具象実装がストレージの詳細を処理（DB、API、ファイル等）
- ビジネスロジックはストレージ機構ではなく抽象インターフェースに依存

### サービスレイヤーパターン

ビジネスロジックを Controller から分離:
- Controller は HTTP 関連の処理のみ
- Service がビジネスロジックを担当
- トランザクション管理は Service 層で実施

## 新機能実装時の手順

1. 既存の類似実装をプロジェクト内で検索
2. 参考になるパターンを特定
3. 既存の抽象基底クラスを継承して実装
4. 既存のユーティリティクラスを活用
