# ADR-0020: Gateway 内部品質リファクタリング

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-gateway（Go BFF、約2,200 LOC）は機能的には十分に動作していたが、
Go のベストプラクティスに照らすと以下の改善点が蓄積していた:

1. **エラーハンドリングの分散**: 各ハンドラが直接 `writeError()` を呼び出し、
   DB エラーをログに残さないケースがあった。エラー処理のパターンがファイルごとに
   微妙に異なり、一貫性に欠けていた。
2. **ドメインエラー型の不在**: 文字列コードのみでエラーを分類しており、
   型安全なエラー判別ができなかった。
3. **リクエスト ID の未伝播**: 構造化ログにリクエスト追跡用 ID がなく、
   プロダクション環境でのデバッグが困難だった。
4. **DB 層のボイラープレート**: `rows.Next() / Scan / append / nil チェック`
   のパターンが全メソッドにコピペされていた。
5. **テスト品質**: テーブル駆動テスト未使用、SSE Consumer テストなし、
   `t.Parallel()` 未使用。
6. **graceful shutdown**: ゴルーチン内の `os.Exit(1)` がデファード処理を
   バイパスし、接続プールやRedisクライアントのクリーンアップが実行されない
   リスクがあった。
7. **recovery middleware**: パニック時にスタックトレースが記録されず、
   原因追跡が困難だった。

**目標**: API 契約（エンドポイント・JSON 形状）を一切変えずに、内部品質を
Go ベストプラクティスに準拠させること。

## 決定事項

API の外部契約を維持したまま、以下の12項目の内部リファクタリングを実施する。
変更は依存関係の順序に従い段階的に適用し、各ステップで `go test` / `go vet` /
`gofmt` がグリーンであることを確認する。

## 実装の概要

### 1. データモデルの分離（`internal/db/models.go`）

`store.go` に混在していた Store インターフェースと10種以上のデータモデル型を分離した。
`store.go` は `Store` インターフェースの定義のみ（18行）となり、
全モデル型は `models.go` に移動した。

### 2. `AppError` ドメインエラー型（`internal/api/errors.go`）

```go
type AppError struct {
    Status  int    // HTTP ステータスコード
    Code    string // マシンリーダブルなエラーコード
    Message string // ヒューマンリーダブルなメッセージ
    Err     error  // 内部エラー（ログ用、レスポンスには含めない）
}
```

`ErrBadRequest`、`ErrNotFound`、`ErrInternal` の3つのコンストラクタを提供。
`error` インターフェースと `Unwrap()` を実装し、`errors.As` / `errors.Is` に対応する。

### 3. `AppHandler` 型とエラーミドルウェア（`internal/api/middleware.go`）

```go
type AppHandler func(w http.ResponseWriter, r *http.Request) error
```

`handleApp()` アダプタが `AppHandler` を `http.HandlerFunc` に変換し、
返却されたエラーを `*AppError` に型アサートして一元的にログ記録とレスポンス生成を行う。
内部エラー（`AppError.Err`）はログに記録するがクライアントには返さない。

### 4. 全ハンドラの `AppHandler` 化

6つのハンドラファイル（`projects.go`、`targets.go`、`findings.go`、
`finding_detail.go`、`top_risks.go`、`timeline.go`）すべてを
`error` を返すシグネチャに変更した。

`parseUUID` は `(w http.ResponseWriter, s string) → (uuid.UUID, bool)` から
`(s string) → (uuid.UUID, error)` に変更し、`*AppError` を返す形にした。
カーソルパース関数（`parseFindingCursor`、`parseTimelineCursor`）も同様に
`*AppError` を返す形に統一した。

### 5. リクエスト ID ミドルウェア

`requestIDMiddleware` を追加し、ミドルウェアチェーンに組み込んだ:

```
recovery → requestID → logging → CORS → mux
```

- `X-Request-ID` ヘッダがあればそのまま伝播
- なければ `uuid.New()` で生成
- `context.Value` に格納し、`RequestID(ctx)` で取得可能
- レスポンスヘッダにも `X-Request-ID` を設定
- `loggingMiddleware`、`handleApp`、`recoveryMiddleware` すべてで request_id を
  ログ属性に含める

### 6. Recovery ミドルウェア強化

`runtime/debug.Stack()` でスタックトレースを取得し、`slog.ErrorContext` で
`stack` 属性として記録するようにした。request_id も含めることで、
パニック発生時のリクエスト特定が容易になった。

### 7. DB 層のボイラープレート削減

**`pgx.CollectRows` の導入**: 手動の `rows.Next() / Scan / append` ループを
`pgx.CollectRows` + スキャン関数（`scanProject`、`scanTarget`、`scanFinding`、
`scanTimelineEvent`）に置き換えた。これにより:

- `defer rows.Close()` が不要（`CollectRows` が内部で処理）
- `rows.Err()` チェックが不要
- nil スライスチェックが不要（`CollectRows` は空の非 nil スライスを返す）

**`orEmpty[T]` ジェネリックヘルパー**: `CollectRows` の結果に対する安全策として
`internal/db/helpers.go` に配置。JSON シリアライズで `null` ではなく `[]` を
保証する。

**適用範囲**:
- `ListProjects`、`ListTargets`: `pgx.CollectRows` + 名前付きスキャン関数
- `ListFindings`、`ListTopRisks`: `pgx.CollectRows` + `scanFinding`（共通）
- `ListTimeline`: `pgx.CollectRows` + `scanTimelineEvent`
- `GetFindingDetail` のサブクエリ（fix versions、exploits、dependency edges）:
  インラインのスキャン関数で `CollectRows` 適用

### 8. Graceful Shutdown 修正（`main.go`）

ゴルーチン内の `os.Exit(1)` を `errCh` パターンに変更:

```go
errCh := make(chan error, 1)
go func() {
    if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
        errCh <- err
    }
}()

select {
case sig := <-quit:
    slog.Info("shutting down", "signal", sig.String())
case err := <-errCh:
    slog.Error("server failed", "error", err)
}
```

これにより、ポートバインド失敗時も `defer pool.Close()` や `defer rdb.Close()` が
確実に実行される。

### 9. Config バリデーション改善（`internal/config/config.go`）

`envRequired` / `envOr` ヘルパー関数を導入し、環境変数の取得パターンを統一した。
`DATABASE_URL` に対して `url.Parse` によるフォーマットバリデーションを追加した。

### 10. SSE Consumer ユニットテスト（`internal/sse/consumer_test.go`）

Redis クライアントを使わずにテスト可能な関数（`toEvent`、`extractProjectID`）に
対するユニットテストを追加:

- `TestToEvent_FindingEvents` — stream → event type マッピング
- `TestToEvent_NotificationEvents` — notification stream のマッピング
- `TestToEvent_UnknownStream` — 未知ストリームの処理
- `TestToEvent_NoPayloadField` — payload フィールド欠損時のフォールバック
- `TestExtractProjectID` — テーブル駆動テスト（valid / missing / invalid JSON / empty）

### 11. テストリファクタリング（`internal/api/router_test.go`）

- 個別テストをテーブル駆動の `TestEndpoints` サブテストに統合
- 全テストに `t.Parallel()` を追加（`t.Setenv` を使う config テストを除く）
- `TestRequestIDHeader` を追加（生成・伝播の検証）

### 12. デッドコード削除

`internal/health/handler.go` を削除。health エンドポイントは `router.go` 内で
インラインに定義されており、このファイルはどこからもインポートされていなかった。

## 代替案

### エラーハンドリング: 標準の `http.Handler` のまま各ハンドラで処理

現行のパターンを維持し、ロギング部分だけ共通化する方法も検討した。
しかし、ハンドラが `writeError` + `return` のペアを確実に呼ぶことを強制する
手段がなく、エラーの握りつぶし（ログなしで 500 を返す）リスクが残るため却下した。
`error` を返すシグネチャにすることで、Go コンパイラが未処理エラーを検出できる。

### DB 層: `pgx.RowToStructByPos` の全面適用

構造体のフィールド順序を SELECT のカラム順序に一致させれば
`pgx.RowToStructByPos[T]` で自動スキャンが可能だが、`Finding` 型のような
JSON タグ付きフィールドでは順序の暗黙的な依存が脆く、
カラム追加時にサイレントなバグを引き起こすリスクがある。
名前付きスキャン関数（`scanFinding` 等）を用いることで、
SELECT と Scan の対応を明示的に保つ方針とした。

### リクエスト ID: OpenTelemetry Trace ID の採用

分散トレーシングの trace ID をリクエスト ID として使う方法も検討したが、
現時点では OpenTelemetry を導入しておらず、過度な依存追加となるため
シンプルな UUID v4 を採用した。将来 OTel 導入時にはこのミドルウェアを
拡張して trace ID を優先的に使う形にする。

## 影響・トレードオフ

### メリット

- **エラーの一元処理**: 全ハンドラのエラーが `handleApp` を経由し、
  内部エラーが確実にログに記録される
- **リクエスト追跡**: request_id により、ログからリクエスト単位で
  エラーを追跡可能になった
- **DB 層の簡素化**: `pgx.CollectRows` により、6メソッド合計で約80行の
  ボイラープレートが削減された
- **テストカバレッジ向上**: SSE Consumer のテストが新規追加され、
  既存テストもテーブル駆動化で網羅性が向上した
- **安全なシャットダウン**: リソースリークのリスクが排除された

### デメリット・リスク

- **エラーコードの変更**: DB エラーのコードが `"db_error"` から
  `"internal_error"` に変わったケースがある。ただし、これらのコードに
  依存するクライアントロジックは現状存在しない（eye はステータスコードで判定）
- **`parseUUID` のシグネチャ変更**: `(w, s) → (uuid.UUID, bool)` から
  `(s) → (uuid.UUID, error)` への変更は、パッケージ内のみの影響で
  外部 API には影響しない

### パフォーマンスへの影響

- `pgx.CollectRows` は内部的に同じ `rows.Next() / Scan` ループを実行するため、
  パフォーマンス特性に変化はない
- `requestIDMiddleware` は UUID 生成のオーバーヘッド（~100ns/op）が加わるが、
  HTTP リクエスト処理時間（~1-100ms）に対して無視できる
- `debug.Stack()` はパニック時のみ呼ばれるため、正常パスへの影響はない

## 今後の課題

- **OpenTelemetry 導入**: 分散トレーシングの統合時に requestIDMiddleware を
  拡張し、trace ID / span ID をログに含める
- **Redis Consumer テストの拡充**: Redis のモックインターフェースを導入し、
  `Run()` メソッド全体のテストカバレッジを向上させる
- **入力バリデーション強化**: `min_epss` の範囲チェック、`event_type` の
  列挙値バリデーションなど、現在暗黙的に処理している入力の明示的な検証
- **メトリクス追加**: Prometheus / OpenTelemetry メトリクスによる
  リクエストレート、レイテンシ、エラーレートの可視化

## 関連するADR

- ADR-0018: DoS Resilience Audit — SSE クライアント制限やタイムアウト設定の導入。
  本 ADR の recovery middleware 強化は ADR-0018 の防御的設計を補完する。
- ADR-0019: Scanner Rust 2024 Refactoring — scanner 側の同様のリファクタリング。
  gateway 側でも同様の内部品質向上を実施した。
