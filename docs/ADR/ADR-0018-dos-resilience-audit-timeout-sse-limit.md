# ADR-0018: DoS耐性監査 — HTTPクライアントタイムアウト追加・SSE接続数制限

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREEの各サービスが外部API・内部APIの双方に対してDoSを引き起こさない設計になっているかを監査した。

監査の結果、NVDクライアント（`enrichment/nvd/client.rs`）にはSemaphoreベースのレート制限（APIキーあり50/30s、なし5/30s）と30sタイムアウトが実装されていた。Oracleのスケジューラはリースベースの重複スキャン防止、GatewayのSSEブローカーは64イベントバッファ＋フル時ドロップを実装済みだった。

一方で以下の懸念点が特定された:

1. **Scanner → OSV/EPSS**: `reqwest::Client` にタイムアウト未設定。外部APIが遅延した場合、スキャンパイプライン全体が無期限にハングする可能性がある（セルフDoS）
2. **Gateway SSE**: `broker.go` の `clients` mapに上限がなく、悪意あるクライアントが大量のSSE接続を張るとメモリ枯渇の恐れがある
3. **Gateway HTTP**: `MaxHeaderBytes` が未設定で、巨大なヘッダーによるリソース消費の可能性がある（GETのみのAPIのためリスクは低い）

## 決定事項

以下の3つの防御策を実装する:

- **P1**: OSV/EPSSクライアントに30秒タイムアウトを追加（NVDクライアントと統一）
- **P2**: SSEブローカーに最大256接続の制限を追加し、超過時は503を返す
- **P3**: GatewayのHTTPサーバーに `MaxHeaderBytes: 1MB` を設定

## 実装の概要

### P1: OSV/EPSSクライアントタイムアウト（decree-scanner）

スキャンパイプラインの `OSV/NVD照合 → EPSS付与` ステージに影響する。

**`services/scanner/src/osv/client.rs`**

`reqwest::Client::builder()` に `.timeout(Duration::from_secs(30))` を追加。これによりバッチクエリ（`query_batch`）とhydration（`fetch_vuln`）の両方に30秒タイムアウトが適用される。NVDクライアントの既存設定と統一した値。

**`services/scanner/src/enrichment/epss/client.rs`**

同様に `reqwest::Client::builder()` に `.timeout(Duration::from_secs(30))` を追加。チャンク単位の逐次リクエストそれぞれに30秒の上限が適用される。

### P2: SSE接続数制限（decree-gateway）

リアルタイムモニタリングのSSEエンドポイントに影響する。

**`services/gateway/internal/sse/broker.go`**

- `MaxSSEClients = 256` 定数と `ErrTooManyClients` エラーを追加
- `Register()` の戻り値を `(uint64, <-chan Event)` → `(uint64, <-chan Event, error)` に変更
- ロック取得後に `len(b.clients) >= MaxSSEClients` をチェックし、超過時はエラーを返す

**`services/gateway/internal/sse/handler.go`**

- `Register()` のエラーハンドリングを追加。`ErrTooManyClients` 時に `503 Service Unavailable` を返す
- SSEヘッダー書き込み前にRegistrationを行うため、通常のHTTPエラーレスポンスとして返却可能

### P3: MaxHeaderBytes（decree-gateway）

**`services/gateway/main.go`**

`http.Server` に `MaxHeaderBytes: 1 << 20`（1MB）を追加。Go標準ライブラリのデフォルト（1MB + 4096バイト）とほぼ同等だが、明示的に設定することで意図を文書化した。

### データモデルへの影響

なし。今回の変更はHTTPクライアント/サーバーの設定変更のみで、fact / resource / projection いずれの層にも影響しない。Atlas migrationの追加も不要。

## 代替案

### P1: タイムアウトをリクエスト単位で設定する

`reqwest::Client` のグローバルタイムアウトではなく、各リクエストに `.timeout()` を個別指定する案。OSV hydrationは1件ずつの逐次処理でありバッチクエリとは応答時間特性が異なるため、個別設定の方が精密な制御が可能。しかし、NVDクライアントの既存パターンがグローバルタイムアウトであり、統一性を優先して却下した。将来的にhydrationの並列化を行う際に再検討の余地がある。

### P2: トークンバケットによるSSEレート制限

接続数の上限ではなく、`golang.org/x/time/rate` を使ったトークンバケット方式でSSE接続を制御する案。より柔軟だが、新たな外部依存を追加する必要があり、現時点ではlocalhost/内部ネットワーク向けツールであるDECREEには過剰。単純な接続数上限の方が理解しやすく、デバッグも容易。

### P2: 接続数上限を128にする

256は多すぎるという議論もありうるが、DECREEはプロジェクト単位のサブスクリプションをサポートしており、複数プロジェクトを監視するダッシュボードでは同時接続数がそれなりに必要。256はSSEの軽量な接続コスト（チャネル＋goroutine）を考慮すると妥当な上限。

### P3: レート制限ミドルウェアの追加

REST APIに対するIPごとのレート制限を `golang.org/x/time/rate` で実装する案。インターネット公開時には必須だが、現時点では内部ツールであり、外部依存の追加に見合わない。公開計画が具体化した際にP3として実装する。

## 影響・トレードオフ

### メリット

- OSV/EPSS APIの遅延・障害時にスキャンパイプラインがハングしなくなる（30秒で失敗に倒れる）
- SSE接続数の上限により、メモリ枯渇のリスクが排除される
- NVD/OSV/EPSSの3つの外部APIクライアントすべてにタイムアウトが設定され、一貫性が確保された

### デメリット・リスク

- `Register()` の戻り値変更はAPIの破壊的変更。ただしパッケージ内部（`sse` パッケージ）に閉じており、外部公開APIではないため影響は限定的
- 30秒タイムアウトはOSVバッチクエリ（最大1000件）に対しては短い可能性がある。ただし実測ではOSV APIは通常数秒で応答するため、30秒は十分なマージン

### パフォーマンスへの影響

- タイムアウト追加によるオーバーヘッドはゼロ（`reqwest` 内部のタイマー設定のみ）
- SSE接続数チェックはロック内での `len(map)` 呼び出し（O(1)）であり、パフォーマンスへの影響は無視できる

## 今後の課題

- **P3: Gateway REST APIレート制限** — インターネット公開時には `golang.org/x/time/rate` ベースのIPごとレート制限が必要
- **OSV hydrationの並列化** — 現在は逐次処理だが、並列化する場合はセマフォによる同時リクエスト数制限が必要（NVDクライアントと同様のパターン）
- **Eye（クライアント側）のリトライ・デバウンス** — ブラウザ単体ではDoS規模にならないが、UXの観点からリトライロジックの追加を検討
- **タイムアウト値の設定ファイル化** — 現在はハードコードだが、環境変数または設定ファイルで外部化するとデプロイ環境ごとの調整が容易になる

## 関連するADR

- ADR-0012: OSVバッチhydration・リースクリーンアップ — hydrationの逐次処理パターンを導入したADR。今回のタイムアウト追加はこのパターンの安全性を補完する
