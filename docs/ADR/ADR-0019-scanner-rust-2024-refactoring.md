# ADR-0019: Scanner Rust 2024 ベストプラクティス大規模リファクタリング

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-scanner（Rust）は edition = 2024、thiserror v2、async-trait 不使用、enum dispatch 採用済みであり、
基本的な技術スタック選択は適切であった。しかし、MVP 開発を優先した結果、以下のコード品質上の問題が蓄積していた。

1. **God function**: `pipeline.rs::run_core()` が約 200 行で、inline SQL が `queries.rs` と重複
2. **Dead code**: `osv/client.rs` に `#[deprecated]` の旧 M1 関数が 2 つ残存
3. **Boilerplate**: `adapter/mod.rs` の手動 enum dispatch が 3 メソッド × 3 バリアント = 9 match arm
4. **Error handling 不統一**: `anyhow::Result` と `crate::error::Result` が混在（`outbox.rs`, `config.rs`）
5. **Too many arguments**: `queries.rs` の `insert_vulnerability_observation` が 9 引数
6. **HTTP クライアント重複構築**: 3 つの外部 API クライアントが同一設定で別々に `reqwest::Client` を構築
7. **Outbox パターン重複**: 同じ `INSERT INTO stream_outbox` が 4 箇所に散在
8. **ConnectError 変換ボイラープレート**: `rpc/service.rs` で毎回手動変換
9. **Transaction 非対応**: `queries.rs` が `&PgPool` のみ受け付け、`&mut Transaction` で使えない

特に問題 9 は、`run_core()` が transaction 内で inline SQL を書かざるを得ない根本原因であり、
他の問題の多くに波及していた。

## 決定事項

scanner サービスのコード品質を Rust 2024 エディションのベストプラクティスに沿って全面的にリファクタリングする。
機能追加は行わず、既存の全テスト（51 unit + 1 integration）をグリーンに保つ。
DECREE Score の計算式には一切触れない。

## 実装の概要

### 1. queries.rs の Executor ジェネリック化

全 13 パブリック関数の引数を `pool: &PgPool` から `executor: E where E: sqlx::Executor<'e, Database = sqlx::Postgres>` に変更した。

これにより `&PgPool`（プール経由）でも `&mut *tx`（transaction 経由）でも同一の query 関数を呼び出せる。
`&PgPool` は `Copy` であるため既存の呼び出し元は一切変更不要。

内部にループを持つ関数（`insert_advisory_fix_versions`, `insert_dependency_edges`）は
単一要素版（`insert_advisory_fix_version`, `insert_dependency_edge`）に分割した。
`Executor` trait は呼び出し時に消費されるため、ループ内での再利用ができないという制約への対応である。

### 2. NewObservation 構造体導入

`insert_vulnerability_observation` の 9 引数を `NewObservation<'a>` 構造体にまとめた。
`#[allow(clippy::too_many_arguments)]` を除去。pipeline.rs の inline SQL と queries.rs の間で
乖離していた列（`epss_score`, `epss_percentile`, `reachability`）を統一した。

### 3. pipeline.rs の inline SQL 排除

`run_core()` 内の全 inline SQL を `queries::` 関数呼び出しに置換した。
新規追加した `queries::get_latest_epss()` で EPSS ルックアップも委譲。
結果として `run_core()` は約 200 行から約 80 行に圧縮され、
純粋なオーケストレーションロジックのみが残った。

### 4. Outbox 重複除去

`enrichment/projection.rs` と `enrichment/exploitdb/sync.rs` にあった
inline の `INSERT INTO stream_outbox` を全て `queries::insert_outbox_event()` に統一した。
outbox イベントの INSERT は全コードベースで `queries.rs` の 1 箇所のみになった。

### 5. Adapter trait + delegate マクロ

Rust 2024 のネイティブ async fn in trait を活用し、`Adapter` trait を定義した。

```rust
#[allow(async_fn_in_trait)]
pub trait Adapter {
    async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()>;
    async fn materialize_sbom(&self, target: &Target, work_dir: &Path) -> Result<NormalizedSbom>;
    async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String>;
}
```

`async_fn_in_trait` lint は、trait が crate 内部の enum dispatch 専用であり
`Send` bound が不要なため、意図的に抑制している。

`delegate_adapter!` マクロにより、enum dispatch の 9 match arm が 3 マクロ呼び出しに簡潔化された。
新しいアダプタバリアント追加時には、マクロの match に 1 行追加するだけで済む。

### 6. From&lt;ScannerError&gt; for ConnectError

`connect/error.rs` に `From<ScannerError>` impl を追加した。
`rpc/service.rs` の enrichment 系メソッド（`sync_epss`, `sync_nvd`, `sync_exploit_db`, `recalculate_scores`）では
`.map_err(|e| ConnectError { ... })` を `?` 演算子に簡潔化した。

`get_scan_status` の `RowNotFound → NotFound` マッピングは意図的なビジネスロジックであるため、
明示的な `map_err` を維持した。

### 7. Error handling 統一

`ScannerError` に `Redis` と `Config` バリアントを追加し、
`outbox.rs` と `config.rs` を `anyhow::Result` から `crate::error::Result` に移行した。
`Cargo.toml` から `anyhow` 依存を完全に削除した。

`main.rs` の戻り値は `Result<(), Box<dyn std::error::Error>>` に変更。
`ScannerError` は `thiserror` により `std::error::Error` を実装しているため、
`?` 演算子でそのまま伝播できる。

### 8. Deprecated コード削除

`osv/client.rs` から以下を削除した:
- `severity_from_cvss()` — `enrichment::score::severity_label()` に完全移行済み
- `provisional_decree_score()` — M1 暫定ロジックで M2 以降不要
- 対応するテスト 2 件（`severity_mapping`, `provisional_score`）

また、`EpssClient::with_client()` と `NvdClient::with_client()` も
テストから参照されていない dead code であったため削除した。

### 9. 共通 HTTP クライアントビルダー

新規 `src/http.rs` モジュールに `default_client()` を定義し、
`OsvClient`, `EpssClient`, `NvdClient` の 3 箇所で共通利用するようにした。
User-Agent (`decree-scanner/0.1`) とタイムアウト (30 秒) の設定が一元化された。

### 影響を受けたデータモデル層

今回のリファクタリングはコードの構造改善のみであり、データモデル自体への変更はない。
スキーマ変更なし、Atlas migration の追加なし。

影響を受けた層:
- **fact table** (`vulnerability_observations`): 書き込みコードパスが queries.rs に統一
- **resource table** (`vulnerability_instances`, `advisory_fix_versions`): 同上
- **projection table** (`current_finding_status`): 同上
- **transient** (`stream_outbox`): outbox INSERT が 1 箇所に集約

## 代替案

### queries.rs のジェネリック化 vs. trait ベースの Repository パターン

Repository trait（`trait ScanRepository { async fn get_scan_job(...); ... }`）を定義し、
`PgRepository` と `TxRepository` の 2 実装を提供する案も検討した。

却下理由: 関数が 14 個あり、trait 定義 + 2 実装で大量のボイラープレートが発生する。
sqlx の `Executor` trait がまさにこの抽象化を提供しており、追加の抽象化層は不要と判断した。

### Executor ジェネリック化でのループ関数の扱い

ループ内で複数回クエリを実行する関数（fix_versions, dependency_edges）について、
`Acquire` trait を使う案も検討した。

却下理由: `Acquire` は接続の取得を抽象化するが、transaction のリボローパターンと相性が悪い。
単一要素版に分割し、呼び出し側でループする方がシンプルかつ型安全であった。

### anyhow 残留 vs. 完全削除

`main.rs` のみ `anyhow::Result` を残す案も検討した。

却下理由: 依存を 1 箇所のためだけに残すのはビルド時間とバイナリサイズの無駄。
`Box<dyn std::error::Error>` で十分であり、`anyhow` の `context()` は
`ScannerError::Config(String)` で代替できた。

### delegate crate vs. 手書きマクロ

`delegate` crate や `enum_dispatch` crate の利用も検討した。

却下理由: 外部依存の追加に見合うほどの複雑さではない。
3 バリアント × 3 メソッドの規模では、10 行程度のマクロで十分であった。

## 影響・トレードオフ

### メリット

- **pipeline.rs の可読性向上**: 200 行 → 80 行。SQL が排除され、ビジネスロジックのみが残った
- **Transaction 対応**: 全 query 関数が transaction 内で利用可能になった
- **Error handling の一貫性**: crate 全体で `thiserror` ベースの `Result<T>` に統一
- **Outbox INSERT の単一責任**: 4 箇所の重複が 1 箇所に集約され、変更時の影響範囲が最小化
- **依存の削減**: `anyhow` 依存を完全に除去
- **Adapter 拡張性**: 新しいターゲットタイプ追加時の必要変更箇所が減少

### デメリット・リスク

- **Executor ジェネリック化の複雑さ**: `'e` ライフタイムパラメータが全関数に付与され、
  Rust 初心者にとっての参入障壁がわずかに上がった
- **単一要素版への分割**: `insert_advisory_fix_version` / `insert_dependency_edge` は
  バッチ INSERT に比べてクエリ発行回数が増えるが、transaction 内でのバッチサイズは小さく、
  性能への影響は無視できる

### パフォーマンスへの影響

スキャンパイプラインのスループットへの影響はない。
query 関数のジェネリック化はコンパイル時にモノモーフィゼーションされるため、
ランタイムのオーバーヘッドはゼロ。HTTP クライアントの共通化により、
クライアント構築のメモリ割り当てが 3 回から 1 回に削減された（起動時のみの影響）。

## 今後の課題

- **queries.rs のバッチ INSERT 最適化**: 現在は単一行ずつ INSERT しているが、
  大量の dependency_edges や fix_versions に対して `sqlx::QueryBuilder` で
  バルク INSERT を実装すれば、大規模スキャン時の DB ラウンドトリップを削減できる
- **Adapter trait の object safety**: 現在は `async fn in trait` で object-safe でないが、
  将来プラグインシステムを導入する場合は `-> impl Future<Output = ...> + Send` へのデシュガーが必要になる
- **query 関数のコンパイル時検証**: `sqlx::query!` マクロによる SQL のコンパイル時チェックは
  未導入。DATABASE_URL 設定が必要となるため、CI パイプライン整備と合わせて検討する

## 関連する ADR

- ADR-0016: CVSS v4.0 スコアリング — DECREE Score 計算に関連する直近の変更
