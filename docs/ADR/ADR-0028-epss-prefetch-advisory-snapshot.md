# ADR-0028: スキャン時 EPSS プリフェッチと advisory_epss_snapshots ベースのクエリ統合

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREE の EPSS スコアはこれまで以下の 2 つの経路で取得・参照されていた:

1. **スキャン時**: `vulnerability_observations` の `epss_score` カラムに、観測時点の EPSS 値を記録。ただしこの値はスキャン実行時に OSV/NVD から取得した CVSS 関連データに付随するもので、EPSS API を直接呼んでいなかった
2. **定期リフレッシュ**: oracle のスケジューラが `SyncEpss` を定期的に呼び出し、scanner 経由で EPSS API からバルク同期。結果は `advisory_epss_snapshots` テーブルに保存

この二重構造に以下の問題があった:

- **初回スキャンで EPSS が欠損する**: 新規ターゲットの初回スキャン時、`advisory_epss_snapshots` にはまだ該当 CVE のデータがなく、`vulnerability_observations.epss_score` も EPSS API を直接呼んでいないため不正確またはゼロの場合があった。定期リフレッシュが走るまで（最大数時間）、DECREE Score の EPSS 成分が欠落していた
- **gateway のクエリが observations の古い値を参照していた**: `ListFindings`・`GetFindingDetail`・`ListTopRisks` のすべてが `vulnerability_observations.epss_score` を直接参照しており、`advisory_epss_snapshots` に最新の EPSS データがあっても利用されていなかった
- **oracle の初回起動時に EPSS データがない**: `runEnrichmentRefresh` はティッカーの初回発火を待ってから同期を開始するため、oracle 起動から最初のリフレッシュ間隔（デフォルト数時間）までは古い EPSS データのまま運用されていた

これらの課題により、特に新規ターゲット追加直後や oracle 再起動直後に DECREE Score の精度が低下していた。

## 決定事項

1. scanner のスキャンパイプラインに **EPSS プリフェッチ**ステップを追加し、OSV バッチ結果から CVE ID を抽出して `advisory_epss_snapshots` に事前取得する
2. gateway のクエリを `advisory_epss_snapshots` の最新スナップショットを優先参照するよう変更し、フォールバックとして `vulnerability_observations.epss_score` を使用する
3. oracle の `runEnrichmentRefresh` をティッカー待ちではなく**起動直後に即時実行**する

## 実装の概要

### scanner — ScanPipeline への EPSS プリフェッチ追加（pipeline.rs）

**パイプラインの新ステップ:**

OSV バッチクエリの直後、トランザクション開始の直前に `prefetch_epss_snapshots()` を呼び出す:

```
SBOM生成 → OSV/NVDバッチ照合 → [EPSS プリフェッチ (NEW)] → トランザクション（findings 永続化）
```

**CVE ID 収集（`collect_cve_ids()`）:**

`OsvBatchResult` からすべての脆弱性を走査し、`primary_id()` が `CVE-` で始まるものを `BTreeSet` で重複排除して収集する。GHSA や RUSTSEC のみの脆弱性は EPSS API の対象外のためスキップ。

**EPSS バッチ取得と保存:**

`EpssClient::fetch_batch()` で CVE ID リストの EPSS データを一括取得し、トランザクション内で `advisory_epss_snapshots` に INSERT する。`ON CONFLICT (cve_id, epss_date) DO NOTHING` により、同日の重複取得は冪等に処理される。

**エラーハンドリング:**

EPSS プリフェッチの失敗はスキャン全体を停止しない。`warn!` ログを出力し、`vulnerability_observations.epss_score` へのフォールバックでスキャンを継続する:

```rust
if let Err(err) = self.prefetch_epss_snapshots(&osv_results).await {
    warn!(error = %err, "EPSS prefetch failed during scan, continuing without fresh EPSS data");
}
```

**ScanPipeline コンストラクタの変更:**

`EpssClient` をコンストラクタパラメータに追加:

```rust
pub fn new(pool: PgPool, osv: OsvClient, epss: EpssClient) -> Self
```

`main.rs` および統合テスト（`integration_scan.rs`）の呼び出し元を更新。

### gateway — EPSS クエリの advisory_epss_snapshots 優先参照（pg_store.go）

**LATERAL JOIN の定数化:**

```sql
LEFT JOIN LATERAL (
    SELECT epss_score
    FROM advisory_epss_snapshots
    WHERE cve_id = vi.advisory_id
    ORDER BY epss_date DESC
    LIMIT 1
) epss ON true
```

この LATERAL サブクエリを `latestEpssJoin` 定数として定義し、`ListFindings`・`GetFindingDetail`・`ListTopRisks` の 3 クエリで共有する。

**COALESCE によるフォールバック:**

EPSS スコアの SELECT を `COALESCE(epss.epss_score, vo.epss_score)` に変更。`advisory_epss_snapshots` に最新値があればそちらを使い、なければ `vulnerability_observations` の値にフォールバックする。

**MinEPSS フィルタの簡素化:**

MinEPSS フィルタの条件を、相関サブクエリ（`EXISTS (SELECT 1 FROM vulnerability_observations ...)`）から `COALESCE(epss.epss_score, vo.epss_score) >= $N` に置換。LATERAL JOIN により既に最新 EPSS が利用可能なため、追加のサブクエリが不要になった。

### oracle — 起動即時リフレッシュとリファクタリング（scheduler.go）

**即時実行:**

`runEnrichmentRefresh()` の `for { select }` ループの前に、EPSS・NVD・ExploitDB の同期を即時実行するよう変更:

```go
s.refreshEpss(ctx)
s.refreshNvd(ctx)
s.refreshExploitDb(ctx)

for {
    select { ... }
}
```

これにより oracle 起動直後から最新のエンリッチメントデータが利用可能になる。

**メソッド抽出:**

`select` ケース内のインラインロジックを `refreshEpss()`・`refreshNvd()`・`refreshExploitDb()` の 3 メソッドに抽出。初回即時実行とティッカー駆動の両方から同一ロジックを呼び出す。

### テスト

**scanner — collect_cve_ids のユニットテスト（pipeline.rs）:**

- GHSA → CVE エイリアスの抽出、CVE ID の重複排除、RUSTSEC（CVE エイリアスなし）のスキップを検証

**oracle — 初回即時実行テスト（scheduler_mock_test.go）:**

- `TestRunEnrichmentRefresh_TriggersInitialSync`: `runEnrichmentRefresh` を起動し 20ms 後にキャンセル。ティッカー間隔（1 時間）より遥かに短い時間内に `syncEpssCalls > 0`、`syncNvdCalls > 0`、`syncExploitCalls > 0`、`recalculateCalls >= 2` を検証
- モックサービスに呼び出しカウンタ（`syncEpssCalls`、`syncNvdCalls`、`syncExploitCalls`、`recalculateCalls`）を追加

### データモデルへの影響

既存の `advisory_epss_snapshots` テーブル（resource table 層）への INSERT が増加する。テーブル構造・スキーマに変更はなく、Atlas migration の追加は不要。fact table への UPDATE は発生しない。

`advisory_epss_snapshots` の `(cve_id, epss_date)` ユニーク制約により冪等性が保証される。

## 代替案

### A: vulnerability_observations の epss_score を直接更新する

スキャン時に EPSS API から取得した値を `vulnerability_observations.epss_score` に書き込む案。しかし `vulnerability_observations` は fact table（INSERT ONLY）であり、UPDATE は DECREE のイミュータブルデータモデルに違反する。`advisory_epss_snapshots` という専用の resource table に分離することで、EPSS の時系列データを独立して管理できる。

### B: gateway で EPSS API を直接呼び出す

クエリ時にリアルタイムで EPSS API を叩く案。レイテンシが増加し、API レート制限にも抵触するリスクがある。スナップショットベースの事前取得の方が応答性能とレート制限の両面で優れている。

### C: oracle の初回同期をティッカー間隔を短くすることで対応する

初回だけティッカー間隔を短くする案。実装の複雑さに対してメリットが小さい。起動時の即時実行の方がシンプルかつ確実。

## 影響・トレードオフ

### メリット

- 新規ターゲットの初回スキャン直後から正確な EPSS スコアが DECREE Score に反映される
- gateway のクエリが `advisory_epss_snapshots` の最新値を優先参照するため、定期リフレッシュの恩恵がフロントエンドに即座に反映される
- oracle 起動直後のエンリッチメントデータの空白期間が解消される
- MinEPSS フィルタの相関サブクエリが LATERAL JOIN ベースに簡素化され、クエリプランが改善される

### デメリット・リスク

- スキャンパイプラインに EPSS API 呼び出しが追加されるため、スキャンのレイテンシが増加する。ただし `warn` + 継続のフォールバック設計により、API 障害時にスキャン全体が失敗するリスクはない
- oracle の起動時に EPSS・NVD・ExploitDB の同期が同期的に実行されるため、起動時間が数秒〜数十秒増加する可能性がある
- `advisory_epss_snapshots` への書き込み頻度が増加する（スキャンごとに追加）。ただし `ON CONFLICT DO NOTHING` により同日重複はスキップされる

### パフォーマンスへの影響

- **スキャンパイプライン**: EPSS バッチ API 呼び出し 1 回 + DB INSERT（CVE 数に比例）が追加。CVE 数は通常数十〜数百のためオーバーヘッドは軽微
- **gateway クエリ**: LATERAL サブクエリが追加されるが、`(cve_id, epss_date)` のインデックスが効くため、行数が少ない `advisory_epss_snapshots` に対する LIMIT 1 の LATERAL は高速
- **oracle 起動**: 初回同期の追加により起動時間が増加するが、以降の動作は変更前と同等

## 今後の課題

- EPSS プリフェッチの結果を `vulnerability_observations.epss_score` にも反映し、fact table の値を「スキャン時点の正確な EPSS」として記録することを検討する（新しい observation INSERT として）
- `advisory_epss_snapshots` の古いスナップショットの自動パージ（retention policy）の導入
- EPSS API のレート制限に対する circuit breaker の導入（スキャン頻度が高い場合の保護）
- gateway の LATERAL JOIN を materialized view やキャッシュで最適化する可能性の検討

## 関連するADR

- ADR-0003: scanner M2 スコアリング・エンリッチメント
- ADR-0005: oracle M3 スケジューラ・差分検出・通知
- ADR-0012: OSV バッチハイドレーション・リースクリーンアップ・ホバー修正
