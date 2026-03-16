# ADR-0021: Oracle サービス大規模リファクタリング

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-oracle はポーリングスケジューラ、差分検出、通知ディスパッチを担うサービスである。MVP 開発を優先した結果、以下のアーキテクチャ上の課題が蓄積していた:

1. **テスタビリティの欠如**: 全コンポーネントが `*db.DB` や `*scanner.Client` などの具象型に直接依存しており、PostgreSQL や scanner サービスが稼働していなければユニットテストが実行不可能だった
2. **goroutine リーク リスク**: 通知チャネル（Slack / Discord / Webhook）の HTTP クライアントにタイムアウトが未設定で、接続先が応答しない場合に goroutine がリークする可能性があった
3. **エラーハンドリングの不備**: `errors.As` の代わりに型アサーションを使用しており wrapped error を正しく処理できなかった。`seedTargets` はエラーをログに記録するだけで呼び出し元に伝搬していなかった
4. **重複コード**: Consumer ID 生成ロジック（`oracle-{hostname}-{pid}`）が `lease.go` と `consumer.go` に分散。Fix version のエンリッチメントが `Detect()` と `allAsNew()` で二重実装
5. **goroutine ライフサイクル管理**: `sync.WaitGroup` と手動の signal channel による停止制御は、goroutine の完了待機やエラー伝搬が不完全だった
6. **ログの構造化不足**: `slog` 呼び出しが `context.Context` を渡しておらず、将来的なトレーシング連携の基盤が欠如していた

ADR-0020 の Gateway リファクタリングに続き、Go Best Practices（Consumer-Side Interface、Functional Options、errgroup パターン）を Oracle にも適用することで、同レベルのコード品質を確保する必要があった。

## 決定事項

Oracle サービスを 7 フェーズに分けてリファクタリングする。各フェーズで `gofmt -l .`、`go vet ./...`、`go test ./...` を全てグリーンに保ちながら段階的に改善する。外部インターフェースの変更はなく、データモデル・Redis Streams イベント設計・gRPC/Connect-RPC プロトコルには一切影響しない。

## 実装の概要

### Phase 1: Quick Wins（命名・タイムアウト・エラーハンドリング）

- `db_target()` → `dbTarget()` へのリネーム（Go 命名規則違反の修正）
- Slack / Discord / Webhook の HTTP クライアントに `Timeout: 30 * time.Second` を追加。goroutine リーク防止
- `scanner/client.go` の `isRetryable()` で `err.(*ConnectError)` 型アサーションを `errors.As(err, &ce)` に変更。wrapped error でも正しくリトライ判定が機能するようになった
- `seedTargets` でエラーを `errors.Join` で集約して返すように変更。一部のターゲット登録が失敗した場合でも残りを試行しつつ、最終的にエラーを呼び出し元に伝搬する

### Phase 2: ドメイン型の抽出

`internal/domain/types.go` を新設し、`Target`、`Observation`、`DeliveryRecord` を `db` パッケージから移動した。`db` パッケージには型エイリアス（`type Target = domain.Target`）を残すことで、既存コードとの後方互換性を維持しながら、各コンシューマーは `domain` パッケージを直接参照する形に段階的に移行した。

これにより、diff / scheduler / notify パッケージが DB 実装に依存せずドメイン型だけを参照できるようになり、Phase 3 のインターフェース抽出の前提条件が整った。

### Phase 3: Consumer-Side Interfaces（Repository Pattern）

Go の構造的型付けを活かし、コンシューマー側にインターフェースを定義した:

| パッケージ | インターフェース | メソッド数 | 責務 |
|-----------|---------------|-----------|------|
| `diff` | `ObservationReader` | 8 | 脆弱性観測データの読み取り・差分記録 |
| `scheduler` | `TargetStore` | 4 | ターゲット・プロジェクトの CRUD |
| `scheduler` | `ScannerService` | 6 | scanner の RPC 操作 |
| `notify` | `DeliveryStore` | 2 | 重複チェック・配信ログ記録 |
| `stream` | `DiffDetector` | 1 | 差分検出 |
| `stream` | `Notifier` | 1 | 通知送信 |

`*db.DB` は Go の構造的型付けによりこれら全てのインターフェースを自動的に満たすため、`main.go` のワイヤリング変更は不要だった。

各パッケージにモックテストファイルを追加し、DB 不要で Detect()、seedTargets、triggerScan、tick、dedup・配信ログ、handleScanCompleted を検証可能にした。

### Phase 4: 重複コードの抽出

- **`internal/identity`**: `OracleConsumerID()` を一箇所に集約。`scheduler/lease.go` と `stream/consumer.go` から参照
- **`enrichFixVersions()`**: `Detect()` と `allAsNew()` で重複していた fix version エンリッチメントループを `Engine` のメソッドとして抽出
- **`notify/httpsend.go`**: `sendJSON()` ヘルパーを新設。Slack / Discord / Webhook の `Send()` メソッドが共通の HTTP 送信ロジックを共有し、各チャネルはペイロード構築とステータスコード検証のみに責務を絞った

### Phase 5: errgroup + Graceful Shutdown

- `main.go`: 手動の signal channel + `sync.WaitGroup` を `signal.NotifyContext()` + `errgroup.WithContext()` に置き換え。health server、scheduler、stream consumer を `g.Go()` で起動し、shutdown goroutine も errgroup 内で context 完了を待機する
- `Scheduler`: `wg errgroup.Group` フィールドを追加。`runEnrichmentRefresh` と `pollScanStatus` の goroutine を `s.wg.Go()` で起動し、`Run()` の return 前に `s.wg.Wait()` で全 goroutine の完了を待機する
- `golang.org/x/sync` を indirect から direct dependency に昇格

### Phase 6: Context-Aware slog

全ファイルの `slog.Info/Error/Warn/Debug()` を `slog.InfoContext(ctx, ...)` 等に機械的に置換した。対象は `db/queries.go`、`diff/engine.go`、`scheduler/scheduler.go`、`stream/consumer.go`、`stream/handler.go`、`notify/router.go`、`scanner/client.go` の約 50 箇所。

これにより、将来 OpenTelemetry の trace ID を context に埋め込んだ際に、ログとトレースが自動的に紐付く基盤が整った。

### Phase 7: Logger Injection（Functional Options パターン）

各構造体に `*slog.Logger` フィールドと Functional Options を追加した:

```go
func NewEngine(repo ObservationReader, opts ...EngineOption) *Engine
func WithLogger(l *slog.Logger) EngineOption
```

デフォルトは `slog.Default()` のため、既存のワイヤリングコードへの影響はゼロ。テストではバッファ付きロガーを注入することで、ログ出力の検証が可能になった。

対象構造体: `diff.Engine`、`scheduler.Scheduler`、`notify.Router`、`stream.EventRouter`、`stream.Consumer`、`scanner.Client`

### 新規ファイル一覧

| ファイル | Phase | 目的 |
|---------|-------|------|
| `internal/domain/types.go` | 2 | ドメイン型の正本 |
| `internal/diff/repository.go` | 3 | ObservationReader インターフェース |
| `internal/diff/engine_mock_test.go` | 3 | DB 不要のユニットテスト |
| `internal/scheduler/repository.go` | 3 | TargetStore / ScannerService インターフェース |
| `internal/scheduler/scheduler_mock_test.go` | 3 | seedTargets / triggerScan / tick のテスト |
| `internal/notify/repository.go` | 3 | DeliveryStore インターフェース |
| `internal/notify/router_mock_test.go` | 3 | dedup・配信ログのテスト |
| `internal/stream/dependencies.go` | 3 | DiffDetector / Notifier インターフェース |
| `internal/stream/handler_mock_test.go` | 3 | handleScanCompleted の E2E テスト |
| `internal/identity/identity.go` | 4 | OracleConsumerID() |
| `internal/identity/identity_test.go` | 4 | ID 生成テスト |
| `internal/notify/httpsend.go` | 4 | sendJSON() ヘルパー |
| `internal/notify/httpsend_test.go` | 4 | HTTP 送信テスト |

## 代替案

### 1. コード生成ベースのモック（mockgen / moq）

`mockgen` や `moq` を導入してインターフェースからモックを自動生成する案を検討した。しかし、Oracle のインターフェースはいずれもメソッド数が 1〜8 と小規模であり、手書きモックで十分カバーできる。コード生成ツールの導入はビルドパイプラインの複雑化と生成ファイルの管理コストを伴うため、現時点では採用しなかった。

### 2. Wire による DI コンテナ

Google Wire を導入して依存関係のワイヤリングを自動化する案も検討した。Oracle の依存グラフは `main.go` で 10 行程度のコンストラクタ呼び出しで完結しており、DI コンテナが解決すべき複雑性が存在しない。Functional Options パターンで十分であると判断した。

### 3. ドメイン型をインターフェースファイル内に定義

`domain` パッケージを新設せず、各インターフェースファイル内にローカルな型を定義する案も検討した。しかし、`Target` 型は `scheduler`、`diff`、`stream` の 3 パッケージから参照されており、型の一元化が必要だった。`db` パッケージに残すと「インターフェースで DB 依存を切り離す」という目的と矛盾するため、専用の `domain` パッケージを新設した。

## 影響・トレードオフ

### メリット

- **テスタビリティの大幅向上**: PostgreSQL・scanner サービス不要で diff 検出、スケジューリング、通知、イベントハンドリングをテスト可能に。mock テストにより CI の実行時間とインフラ依存が削減
- **goroutine 安全性**: HTTP タイムアウトの追加と errgroup による goroutine ライフサイクル管理で、リソースリークと shutdown 時の不完全な停止を防止
- **保守性**: 重複コードの排除と責務の明確化により、各パッケージが単一責務に収束
- **将来のトレーシング基盤**: Context-Aware slog + Logger Injection により、OpenTelemetry 統合の準備が完了

### デメリット・リスク

- **ファイル数の増加**: 13 ファイルが新規追加された。ただし、いずれもインターフェース定義（数行）、テスト、またはヘルパーであり、ビジネスロジックの複雑化は伴わない
- **間接化コスト**: インターフェース経由の呼び出しにより、IDE でのジャンプ先が分散する。ただし Go の構造的型付けにより実装クラスの発見は容易
- **notify パッケージのリトライテスト所要時間**: `alwaysFailChannel` を使用するテストが全リトライ（1s + 5s + 30s）を消化するため約 36 秒かかる。将来的にはテスト用のバックオフ注入を検討すべき

### パフォーマンスへの影響

本リファクタリングは内部構造の改善のみであり、スキャンパイプラインのスループット、Redis Streams の処理性能、HTTP API のレイテンシには影響しない。Interface dispatch のオーバーヘッドはナノ秒オーダーであり、DB クエリや HTTP 通信のレイテンシと比較して無視できる。

## 今後の課題

- **バックオフ注入**: 通知リトライと scanner クライアントリトライのバックオフを Functional Options で注入可能にし、テスト所要時間を削減する
- **LeaseManager のインターフェース化**: 現在 `*LeaseManager` は具象型のまま。テスタビリティ向上のためインターフェース化を検討する
- **OpenTelemetry 統合**: Phase 6-7 で整備した基盤を活かし、trace ID のログ連携と分散トレーシングを導入する
- **Integration Test の整備**: モックテストではカバーできない DB + Redis + scanner の結合テストをCI に追加する

## 関連するADR

- ADR-0019: Scanner (Rust) 2024 Edition リファクタリング
- ADR-0020: Gateway リファクタリング
