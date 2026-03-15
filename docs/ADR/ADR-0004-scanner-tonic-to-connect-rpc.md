# ADR-0004: decree-scanner tonic (gRPC) → Connect-RPC 移行

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

M0〜M2 の実装計画（PLAN1.md）では、サービス間通信プロトコルとして Connect-RPC を指定していた。しかし M1・M2 の実装時に Rust 側の Connect-RPC エコシステムが未成熟であったため、tonic (gRPC) を暫定的に採用した。

この結果、以下の乖離が発生していた:

- **仕様と実装の不一致**: PLAN1.md は Connect-RPC を規定しているが、scanner は tonic の gRPC サーバとして動作していた
- **Oracle (Go) 側との整合性**: buf.gen.yaml には既に `buf.build/connectrpc/go` プラグインが設定されており、Go 側は Connect-RPC クライアントを前提としていた。tonic の gRPC サーバに対して Connect-Go クライアントを接続する場合、HTTP/2 フレーミングの互換性に注意が必要になる
- **デバッグ・運用の複雑さ**: gRPC は HTTP/2 バイナリフレーム上で動作するため、`curl` による手動テストやログでのリクエスト確認が困難だった

Connect-RPC unary プロトコルは本質的に `POST /{package}.{Service}/{Method}` + JSON body という単純な HTTP/1.1 互換プロトコルであり、axum のルーティングで直接実装可能である。Rust に成熟した Connect-RPC ライブラリは存在しないが、プロトコル自体がシンプルなため薄い実装で十分対応できると判断した。

## 決定事項

scanner の RPC 層から tonic 依存を完全に除去し、prost（メッセージ型生成）+ pbjson（serde 対応）+ axum（HTTP ハンドラ）による Connect-RPC unary プロトコルの直接実装に置き換える。

## 実装の概要

### 依存関係の変更

`Cargo.toml` から以下を変更:

- **削除**: `tonic = "0.12"`, `tonic-build = "0.12"`
- **追加**: `pbjson = "0.7"`, `prost-build = "0.13"`, `pbjson-build = "0.7"`
- **維持**: `prost = "0.13"`, `axum = "0.7"`, `serde`, `serde_json`

### ビルドシステム（build.rs）

`tonic_build` を `prost_build` + `pbjson_build` に置換した。2 段階のコード生成を行う:

1. `prost_build::Config` で proto をコンパイルし、file descriptor set を出力
2. `pbjson_build::Builder` で descriptor set から `Serialize` / `Deserialize` impl を生成

生成物は `scanner.v1.rs`（prost 型定義）と `scanner.v1.serde.rs`（serde impl）の 2 ファイル。pbjson は proto フィールド名を Connect-RPC 仕様準拠の camelCase（`targetId`, `scanId`）に自動変換する。

### Connect プロトコル層（新規モジュール `src/connect/`）

Connect-RPC の unary プロトコルを実装する薄い層を新設した:

- **`connect/error.rs`**: `ConnectError` 構造体と `ConnectCode` enum。Connect spec 準拠の JSON エラーモデル（`{"code":"not_found","message":"..."}`）を提供し、`ConnectCode::http_status()` で Connect code → HTTP status の標準マッピングを行う
- **`connect/handler.rs`**: `connect_response()` ヘルパー。`Result<T, ConnectError>` を受け取り、成功時は HTTP 200 + `application/json`、失敗時は適切な HTTP status + Connect error JSON を返す axum レスポンスに変換する

### RPC サービス層のリファクタ

`src/grpc/` ディレクトリを `src/rpc/` にリネームし、tonic 固有の型を除去した:

- `ScannerGrpcService` → `ScannerRpcService`、`EnrichmentGrpcService` → `EnrichmentRpcService`
- `#[tonic::async_trait]` + trait impl → plain `async fn` メソッド（Rust 2024 edition のネイティブ async trait で十分）
- `tonic::Request<T>` / `tonic::Response<T>` ラッパー → 直接 `T` を受け取り `T` を返す
- `tonic::Status` → `ConnectError`（`invalid_argument` / `not_found` / `internal` の 1:1 マッピング）
- ビジネスロジック（スキャンジョブ作成、パイプライン起動、EPSS/NVD/Exploit-DB 同期、DECREE Score 再計算）は一切変更なし

### ルーター組み立て（main.rs）

`tonic::service::Routes` による gRPC サービス登録を、axum `Router` での明示的な Connect-RPC パス定義に置き換えた:

```
POST /scanner.v1.ScannerService/RunScan
POST /scanner.v1.ScannerService/GetScanStatus
POST /scanner.v1.EnrichmentService/SyncEpss
POST /scanner.v1.EnrichmentService/SyncNvd
POST /scanner.v1.EnrichmentService/SyncExploitDb
POST /scanner.v1.EnrichmentService/RecalculateScores
GET  /healthz
```

`AppState` 構造体に `Arc<ScannerRpcService>` と `Arc<EnrichmentRpcService>` を格納し、各ルートハンドラから共有する。

### buf.gen.yaml の整理

Rust のコード生成は `build.rs` で完結するため、`buf.build/protocolbuffers/prost` プラグイン行を削除した。Go の `protocolbuffers/go` と `connectrpc/go` プラグインはそのまま維持している。

### データモデルへの影響

なし。本変更はトランスポート層のみに影響し、fact / resource / projection いずれのテーブルにも変更はない。スキャンパイプラインのビジネスロジックは完全に保持されている。

## 代替案

### 代替案 1: tonic を維持し、Connect-Go のgRPC 互換モードを利用

Connect-Go クライアントは gRPC プロトコルもサポートしているため、scanner 側を変更せずに Oracle から接続することも技術的には可能だった。しかし、仕様（PLAN1.md）との乖離が残り続けること、gRPC の HTTP/2 バイナリフレームによるデバッグ困難さが解消されないこと、tonic 依存によるビルド時間増加が続くことから不採用とした。

### 代替案 2: connect-es / connect-web 等の既存 Connect ライブラリ移植を待つ

Rust 向けの Connect-RPC ライブラリが将来登場する可能性はあるが、unary RPC のプロトコルは `POST` + JSON という極めて単純な仕様であり、自前実装のコスト（約 50 行の handler + error モジュール）が外部依存を待つコストを大幅に下回ると判断した。

### 代替案 3: serde impl を手書き（pbjson 不使用）

proto メッセージ型は 8 種類でいずれもフラットな構造のため、手書きの serde wrapper 型でも対応可能だった。しかし pbjson は camelCase 変換やデフォルト値処理を Connect spec 準拠で自動処理するため、仕様追従の確実性を優先して pbjson を採用した。

## 影響・トレードオフ

### メリット

- **仕様との一致**: PLAN1.md が規定する Connect-RPC プロトコルに完全準拠
- **デバッグ容易性**: `curl -X POST -d '{"targetId":"..."}' /scanner.v1.ScannerService/RunScan` で直接テスト可能
- **依存削減**: tonic + tonic-build（+ h2, hyper HTTP/2 スタック等の transitive deps）が不要になり、ビルドが高速化
- **Oracle 連携の簡素化**: Go 側は `buf generate` で Connect-Go クライアントを生成するだけで接続可能（HTTP/1.1 JSON で通信）
- **テスタビリティ向上**: RPC メソッドが plain async fn になったことで、tonic の `Request`/`Response` ラッパーなしに直接ユニットテスト可能

### デメリット・リスク

- **バイナリプロトコル未対応**: `application/proto`（Protocol Buffers バイナリ）は初期実装ではサポートしない。JSON のみの対応だが、現時点のユースケースではパフォーマンス上の問題はない
- **ストリーミング RPC 未対応**: Connect-RPC の server streaming はより複雑な実装が必要だが、現在の scanner の全 RPC は unary のため影響なし
- **Connect spec の部分実装**: タイムアウトヘッダ（`Connect-Timeout-Ms`）やメタデータ伝播は未実装。必要になった時点で追加する

### パフォーマンスへの影響

RPC のシリアライゼーションが Protocol Buffers バイナリから JSON に変わるが、リクエスト/レスポンスはいずれも小さなメッセージ（UUID 文字列、カウント値程度）であり、差は無視できる。HTTP/2 フレーミングのオーバーヘッドが除去されるため、単純なリクエストではわずかにレイテンシが改善する可能性がある。

## 今後の課題

- **Oracle Connect-Go クライアント実装**: M3 で `buf generate` により Go の Connect クライアントスタブを生成し、Oracle から scanner の EnrichmentService を呼び出す
- **`application/proto` 対応**: 高スループットが必要になった場合、`Content-Type` ヘッダに基づいてバイナリ/JSON を切り替える実装を追加
- **エラーモデルの拡充**: `ConnectCode` に現在含まれていないコード（`permission_denied`, `deadline_exceeded` 等）を必要に応じて追加

## 関連する ADR

- ADR-0002: decree-scanner M1 — SBOM・OSV パイプライン（tonic gRPC サーバの初期実装）
- ADR-0003: decree-scanner M2 — Scoring Enrichment（EnrichmentService の追加）
