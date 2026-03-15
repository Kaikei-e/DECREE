# ADR-0002: decree-scanner M1 — SBOM 正規化パイプラインと OSV バッチ照合の設計

## ステータス

Accepted

## 日付

2026-03-15

## コンテキスト

M0 で DB スキーマ（Atlas migration）、Docker Compose オーケストレーション、Redis Streams 初期化が完成した。しかし decree-scanner は `/healthz` エンドポイントのみの空シェルであり、スキャン機能は未実装だった。

M1 の目標は scanner を「動くスキャンパイプライン」に変えることである。具体的には、gRPC ジョブ受信 → ターゲット準備 → SBOM 生成/取込 → OSV 照合 → observation fact 永続化 → outbox イベント発行の全フローを一気通貫で動作させる。

設計にあたり以下の制約・要求が存在した。

### マルチフォーマット SBOM 対応

PLAN1.md は scanner が「SBOM を生成する機能と受け取る機能の両方を持つ」ことを要求している。CI パイプラインで既に CycloneDX や SPDX を出力している環境では直接取り込み、SBOM 基盤がない環境では DECREE 自身が Syft をラップして生成する必要がある。入力フォーマットは CycloneDX JSON、SPDX JSON、Syft JSON の 3 種があり、これらを統一的に扱う正規化層が不可欠だった。

### 3 種のターゲット型

`targets` テーブルの `target_type` は `git`（リポジトリ clone → Syft 実行）、`container`（コンテナイメージを Syft でスキャン）、`sbom`（既存 SBOM ファイルまたは URL を直接取り込み）の 3 種。各ターゲットの prepare → SBOM 取得 → fingerprint のライフサイクルが異なるため、共通インターフェースで抽象化する必要があった。

### Rust 2024 Edition の設計方針

Rust 1.85+ では `async fn in trait` がネイティブでサポートされており、`async-trait` クレートは不要。ターゲット型は固定 3 種であるため、`Box<dyn Trait>` の動的ディスパッチではなくコンパイル時に網羅性が保証される enum dispatch が適切と判断した。

### DECREE Score の暫定計算

正式な DECREE Score は `(CVSS_base × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 0.25)` だが、EPSS と Reachability の実装は M2 に先送りされている。M1 では CVSS コンポーネントのみ `DECREE Score = CVSS_base × 0.4` として暫定計算する。

### イミュータブルデータモデルとの整合

DECREE のデータモデルは fact table を INSERT ONLY とする設計である。スキャン結果は `vulnerability_observations`（fact table）に挿入し、`current_finding_status`（projection table）を UPSERT で更新する。1 スキャンの全 finding を単一トランザクションで永続化し、途中失敗による部分書き込みを防ぐ必要があった。

## 決定事項

decree-scanner を以下 5 つのコンポーネントで構成するスキャンパイプラインとして実装する。

1. **SBOM 正規化層** — CycloneDX / SPDX / Syft JSON を統一モデル `NormalizedSbom` に変換
2. **TargetAdapter enum dispatch** — Git / Container / Sbom の 3 種を共通ライフサイクル（prepare → materialize_sbom → fingerprint）で抽象化
3. **OSV バッチクライアント** — OSV.dev の `/v1/querybatch` で 1000 件チャンク照合
4. **gRPC サービス** — `RunScan`（fire-and-forget）と `GetScanStatus` で oracle からのジョブ受付
5. **Transactional Outbox** — DB トランザクション内で `stream_outbox` に INSERT し、バックグラウンドタスクで Redis Streams に配信

## 実装の概要

### スキャンパイプラインのデータフロー

```
SBOM生成 → OSV照合 → (EPSS付与: M2) → DECREE Score算出(暫定) → 分類
```

パイプラインのうち、M1 では SBOM 生成と OSV 照合のステージを実装した。EPSS 付与は M2 で追加予定であり、パイプライン構造はこの拡張を考慮して設計されている。

### モジュール構成

```
services/scanner/src/
├── config.rs          # DATABASE_URL, REDIS_URL を env から読み込み
├── error.rs           # ScannerError enum (thiserror)
├── outbox.rs          # stream_outbox → Redis Streams ポーリング発行
├── db/
│   ├── models.rs      # Target, ScanJob, Scan の sqlx::FromRow 構造体
│   └── queries.rs     # upsert_vulnerability_instance 等 11 クエリ関数
├── sbom/
│   ├── model.rs       # NormalizedSbom, NormalizedPackage, Ecosystem enum, DependencyEdge
│   ├── cyclonedx.rs   # bomFormat フィールドで検出、components[].purl から ecosystem 推定
│   ├── spdx.rs        # spdxVersion で検出、externalRefs から purl 抽出
│   ├── syft.rs        # artifacts フィールドで検出、language フォールバックで ecosystem 推定
│   └── detect.rs      # JSON プローブによるフォーマット自動検出 → パーサーディスパッチ
├── osv/
│   ├── types.rs       # OSV API リクエスト/レスポンスの serde 型
│   └── client.rs      # バッチクエリ + severity/score ヘルパー関数
├── adapter/
│   ├── mod.rs         # TargetAdapter enum (Git | Container | Sbom) + 共通メソッド委譲
│   ├── git.rs         # git clone --depth 1 → syft -o cyclonedx-json → parse
│   ├── container.rs   # syft <image> -o cyclonedx-json → parse
│   └── sbom.rs        # reqwest fetch or fs copy → 自動検出 parse
├── scan/
│   └── pipeline.rs    # ScanPipeline::execute() — パイプライン全体のオーケストレーション
├── grpc/
│   ├── mod.rs         # tonic::include_proto!("scanner.v1")
│   └── service.rs     # RunScan (tokio::spawn で非同期実行), GetScanStatus
└── main.rs            # gRPC + HTTP(/healthz) 多重化サーバー、OutboxPublisher 起動
```

### `ScanPipeline::execute` の処理フロー

```
1. scan_job 読取 → target 取得
2. job status = "running"
3. scans INSERT (status=running)
4. tempdir 作成
5. TargetAdapter::from_target(target_type)
6. adapter.prepare()           — git clone / no-op / URL fetch
7. adapter.materialize_sbom()  — syft 実行 or SBOM parse
8. adapter.fingerprint()       — git rev-parse / image ref / SHA-256
9. OsvClient::query_batch()    — OSV.dev バッチクエリ
10. BEGIN TRANSACTION:
    a. ∀ (package, vuln): upsert vulnerability_instance
    b. INSERT vulnerability_observation (cvss, decree_score, severity)
    c. INSERT advisory_fix_versions
    d. UPSERT current_finding_status
    e. INSERT dependency_edges
    f. UPDATE scans → completed + sbom_hash
    g. INSERT stream_outbox (scan.completed)
    COMMIT
11. job status = "completed"
```

エラー発生時は scan を failed に更新し、outbox に `scan.failed` イベントを発行する。

### データモデル変更

**影響を受ける層: resource table**

`vulnerability_instances` テーブルに upsert 用のユニークインデックスを追加した。同一ターゲット・パッケージ・アドバイザリの組み合わせが複数スキャンで重複 INSERT されることを防ぎつつ、ON CONFLICT DO UPDATE で既存レコードの ID を取得する。

```sql
-- Atlas migration: 20260315100000_add_vuln_instance_unique.sql
CREATE UNIQUE INDEX idx_vuln_instance_key
  ON vulnerability_instances (target_id, package_name, package_version, ecosystem, advisory_id);
```

`db/schema.hcl` にも対応する `index` 定義を追加し、スキーマ正本との一貫性を維持した。

fact table（`vulnerability_observations`）は INSERT ONLY の設計原則を維持。projection table（`current_finding_status`）は UPSERT で最新スキャン結果に更新。

### Redis Streams イベント設計

Transactional Outbox パターンを採用した。パイプラインの DB トランザクション内で `stream_outbox` テーブルに INSERT し、`OutboxPublisher` バックグラウンドタスクが 1 秒間隔でポーリング → `XADD` → `published=true` に更新する。

| ストリーム | イベント | ペイロード |
|---|---|---|
| `scan-events` | `scan.completed` | `{scan_id, target_id, findings_count}` |
| `scan-events` | `scan.failed` | `{scan_id, target_id, error}` |

### gRPC サービスと HTTP 多重化

`RunScan` は scan_job を DB に作成した後、`tokio::spawn` でパイプラインを非同期実行し即座に job_id を返す（fire-and-forget パターン）。oracle はポーリングまたは Redis Streams で完了を検知する。

tonic 0.12 の `Routes::into_axum_router()` で gRPC サービスを axum Router に変換し、`/healthz` HTTP エンドポイントと同一ポート（9000）で提供する。

### Dockerfile とビルド構成の変更

- `docker-compose.yml` の scanner ビルドコンテキストをリポルート（`.`）に変更。proto ファイル（`proto/scanner/v1/scanner.proto`）を Docker ビルド内で参照するため
- builder ステージ: `rust:1.94.0-bookworm` + `protobuf-compiler`。`WORKDIR /app/services/scanner` で build.rs の `../../proto` 相対パスを維持
- runtime ステージ: `debian:bookworm-slim` + `git`, `curl`, Syft バイナリ
- builder と runtime の Debian バージョンを bookworm に統一（GLIBC バージョン不一致を防止）

### テスト戦略

| テスト種別 | 対象 | 実行方法 |
|---|---|---|
| SBOM パーサー unit test | cyclonedx / spdx / syft / detect | fixture JSON → `cargo test` |
| OSV ヘルパー unit test | severity_from_cvss / provisional_decree_score | `cargo test` |
| 統合テスト | ScanPipeline::execute (sbom target) | DB + fixture → `cargo test --test integration_scan` |

fixture ファイルは `tests/fixtures/` に最小の CycloneDX / SPDX / Syft / OSV レスポンス JSON を配置。9 unit tests + 1 integration test で合計 10 テストが通過する。

## 代替案

### SBOM 正規化を行わず CycloneDX のみサポートする

Syft のデフォルト出力は CycloneDX JSON であるため、Git / Container ターゲットはこれだけで動作する。しかし PLAN1.md は SBOM 直接入力フォーマットとして CycloneDX JSON と SPDX JSON の両方を明記しており、SPDX 対応を省略できない。また、3 パーサーの実装コストは各 60〜80 行と軽量であり、正規化層を設けることで将来のフォーマット追加（例: OWASP Dependency-Track 出力）が容易になる。

### `TargetAdapter` を `Box<dyn Trait>` で実装する

従来の Rust パターンでは trait object が一般的だが、ターゲット型は `git` / `container` / `sbom` の固定 3 種であり、動的ディスパッチのオーバーヘッドと型消去によるデバッグ困難さに見合わない。enum dispatch はコンパイル時に全バリアントが列挙され、match の網羅性チェックが働く。Rust 2024 Edition で `async fn in trait` がネイティブサポートされたため、`async-trait` クレートによるヒープアロケーションも回避できる。

### OSV クエリを個別リクエスト（`/v1/query`）で行う

OSV は単一クエリ API も提供しているが、数百パッケージのスキャンでは HTTP ラウンドトリップが支配的になる。バッチ API（`/v1/querybatch`）は 1 リクエストで最大 1000 件をクエリでき、ネットワーク効率が大幅に改善される。

### パイプライン結果を直接 Redis Streams に `XADD` する

DB トランザクション内で直接 Redis に書き込むと、Redis が一時的に不到達の場合にトランザクション全体が失敗する。Transactional Outbox パターンにより DB 永続化と Redis 配信を分離し、at-least-once delivery を保証した。ポーリング間隔 1 秒の遅延はスキャン結果のリアルタイム性要件に対して許容範囲。

### tonic 0.14 を採用する

当初 tonic 0.14 を計画していたが、0.14 で `tonic-build` の `compile_protos()` / `configure()` API が廃止され、手動コード生成アプローチに移行していた。proto ファイルからの自動 codegen という既存ワークフローを維持するため、tonic 0.12 を採用した。tonic 0.12 は axum 0.7 との互換性があり、`Routes::into_axum_router()` で gRPC + HTTP の多重化も可能。

## 影響・トレードオフ

### メリット

- **SBOM フォーマット非依存**: CI 環境が CycloneDX / SPDX / Syft JSON のいずれを出力しても同一パイプラインで処理可能
- **トランザクション一貫性**: 1 スキャンの全 finding が原子的に永続化され、部分書き込みによるデータ不整合が発生しない
- **Outbox パターンによる配信保証**: Redis 障害時もスキャン結果は DB に永続化されており、復旧後に配信される
- **テスタビリティ**: SBOM パーサーは I/O を含まない純粋関数で fixture ベースのテストが容易。OSV クライアントは wiremock でモック可能
- **fire-and-forget gRPC**: oracle はスキャン完了を待たずに次のジョブをスケジュール可能

### デメリット・リスク

- **Syft バイナリ依存**: Git / Container ターゲットは runtime に Syft バイナリが必要であり、Docker イメージサイズが増加する。将来マニフェスト自前パーサーを実装することで削減可能
- **M1 暫定スコア**: `DECREE Score = CVSS × 0.4` は EPSS / Reachability 未考慮のため最終形とは異なる。M2 で完全な DECREE Score 計算に置換予定
- **OSV API 外部依存**: OSV.dev がダウンするとスキャンが失敗する。リトライ・キャッシュ・NVD フォールバックは M2 以降で対応
- **tonic 0.12**: 最新の 0.14 ではなく 0.12 を採用したため hyper 1.0 対応は含まれない。ただし scanner の gRPC 通信は内部ネットワーク限定であり、影響は軽微

### パフォーマンスへの影響

- **SBOM パース**: serde_json による JSON デシリアライズは高速であり、数千パッケージの SBOM でもミリ秒単位で完了する
- **OSV バッチクエリ**: 1000 件/リクエストのチャンクにより HTTP ラウンドトリップを最小化。典型的なプロジェクト（100〜500 パッケージ）は 1 リクエストで完了
- **DB 書き込み**: 単一トランザクション内で N 回の INSERT/UPSERT を実行。N が数百を超える場合は COPY プロトコルへの移行を検討する（M2 以降）
- **Outbox ポーリング**: 1 秒間隔、100 件/バッチ。スキャン頻度に対して十分なスループット

## 今後の課題

- **M2**: NVD API クライアント + EPSS マッチングの実装により完全な DECREE Score 算出を実現
- **M2**: OSV/NVD レスポンスキャッシュ（Redis）の導入でレート制限に対応
- **M2**: Reachability スコア算出（依存グラフの深度 + `exposure_class` からの推定）
- **M3**: oracle → scanner の gRPC 連携テスト（End-to-End）
- Syft バイナリバージョンの固定（現在は install.sh の latest を取得）
- CVSS ベクタ文字列からの数値スコア算出（現在はスコアが直接提供される場合のみ対応）

## 関連するADR

- [ADR-0001](ADR-0001-sveltekit-biome-pnpm.md): decree-eye のフロントエンド技術スタック決定
