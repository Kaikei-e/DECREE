# ADR-0005: decree-oracle M3 — スケジューラ・差分検出・通知

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-oracle は M0 時点でヘルスエンドポイントのみのスケルトン（`main.go` + `internal/health/handler.go`）だった。DECREE を「スキャン結果を見るだけのツール」から「運用ワークフローに組み込めるツール」へ引き上げるため、M3 で以下の 3 機能を実装する必要があった:

1. **定期ポーリング**: `decree.yaml` で定義されたターゲットに対し、設定間隔で scanner にスキャンを発行する
2. **差分検出**: 連続するスキャン間の脆弱性変化（新規検出・解消・スコア変動・新規エクスプロイト）を fact table ベースで検出する
3. **通知**: 差分イベントを Slack / Discord / generic webhook に配信し、運用チームが即時対応できるようにする

M1-M2 で scanner 側の Connect-RPC サーバ（ADR-0004）、Outbox → Redis Streams パブリッシャー、SBOM/OSV/EPSS/NVD/Exploit-DB パイプラインが完成済みであり、oracle はこれらを「消費する側」として実装する。

### 技術的制約

- scanner (Rust) は手動 Connect-RPC 実装（axum + prost + pbjson）で camelCase JSON を返す。oracle (Go) 側のクライアントは pbjson の camelCase 規約に合わせる必要がある
- 差分検出は projection table (`current_finding_status`) を読まず、fact table のみから導出するという設計原則に従う
- 複数 oracle インスタンスの同時実行に備え、排他的リース機構が必要

## 決定事項

decree-oracle を Go で実装し、スケジューラ・Redis Streams コンシューマ・差分エンジン・通知ルーターの 4 コンポーネントを統合する。scanner との通信は Connect-RPC JSON プロトコル（HTTP/1.1 POST）で行い、`buf generate` による Go コード生成は使わず手動定義の型で直接通信する。

## 実装の概要

### パッケージ構成

```
services/oracle/
  main.go                          -- エントリポイント（統合）
  internal/
    health/handler.go              -- ヘルスチェック（既存）
    config/config.go               -- decree.yaml パース + env/secrets
    db/db.go, queries.go           -- pgx pool + 全 SQL クエリ
    scanner/client.go, types.go    -- Connect-RPC クライアント
    scheduler/scheduler.go         -- time.Ticker ループ + target 管理
    scheduler/lease.go             -- job_leases 排他制御
    stream/consumer.go             -- Redis Streams XREADGROUP
    stream/handler.go              -- イベントディスパッチ
    diff/engine.go, types.go       -- fact ベース差分検出
    notify/router.go               -- severity filter + dedup + dispatch
    notify/slack.go                -- Slack Block Kit
    notify/discord.go              -- Discord Embed
    notify/webhook.go              -- generic webhook
    notify/dedup.go                -- SHA256 ベース重複排除
    notify/types.go                -- Channel interface + メッセージ型
```

### データモデルの変更

2 つのテーブルを追加した。いずれも resource table に分類される。

**`job_leases`**: target ごとに 1 行の排他ロック。`INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < now()` でアトミックな取得と期限切れ再取得を実現する。

**`notification_delivery_log`**: 通知配信の記録と重複排除。`(dedup_key, channel)` の unique index で同一日内の重複送信を防止する。

Atlas migration ファイル: `db/migrations/20260316000000_m3_job_leases.sql`

### Scanner Connect-RPC クライアント

`internal/scanner/` に手動定義の型（`types.go`）と HTTP クライアント（`client.go`）を実装した。`buf generate` による Go コード生成（`connectrpc.com/connect`）は不使用で、理由は以下の通り:

- scanner 側が pbjson で camelCase JSON を返すため、手動定義型の json タグで直接マッピングする方が確実
- 依存するのは `net/http` と `encoding/json` のみで、外部ライブラリ不要
- unary RPC 6 エンドポイントのみのため、コード生成のオーバーヘッドに見合わない

リトライは exponential backoff（1s → 5s → 30s、最大 3 回）で、`unavailable` / `deadline_exceeded` エラーのみ対象。

### スケジューラ

`internal/scheduler/scheduler.go` が以下のライフサイクルを管理する:

1. **起動時**: `decree.yaml` のターゲットを DB に seed（`EnsureProject` → `UpsertTarget`）
2. **初回スキャン**: `initial_scan: true` なら全ターゲットに即時 `RunScan`
3. **定期ティック**: `time.Ticker`（resolution = min(interval, 30s)）で全ターゲットを巡回。次回実行時刻を per-target で管理し、due なもののみスキャン発行
4. **リース管理**: スキャン前に `job_leases` で排他取得。TTL = 2 × scan interval。スキャン完了/失敗後にリリース
5. **enrichment refresh**: 別 goroutine で EPSS(24h), NVD(6h), ExploitDB(6h) を定期的に scanner に同期依頼し、完了後に `RecalculateScores` を呼び出す

### Redis Streams コンシューマ

`internal/stream/consumer.go` が `XREADGROUP` ループを実行する:

- Consumer group: `oracle-diff`（`scripts/init-redis.sh` に追加）
- `XREADGROUP BLOCK 5000 COUNT 10`
- 起動時に `XAUTOCLAIM`（idle > 60s）で pending メッセージを回収
- handler 成功で `XACK`、失敗時は ack せず再配信に任せる

`internal/stream/handler.go` の `EventRouter` がイベントタイプでディスパッチ:
- `scan.completed` → diff engine → notification router
- `scan.failed` → ログのみ

### 差分検出エンジン

`internal/diff/engine.go` が fact table のみから差分を検出する:

1. 現 scan の `vulnerability_observations JOIN vulnerability_instances` で observation 集合を取得
2. 前回 completed scan を `scans` テーブルから取得（`ORDER BY completed_at DESC LIMIT 1`）
3. 前回 observation 集合を取得
4. 集合差分:
   - `current - previous` → **new_cve**
   - `previous - current` → **resolved_cve**（+ `vulnerability_disappearances` INSERT）
   - 共通かつ `|decree_score diff| > 0.5` → **score_change**
   - `exploit_cve_links` の新規出現 → **new_exploit**
5. 各 diff event を `finding-events` stream に outbox INSERT

**重要**: projection table (`current_finding_status`) は一切読まない。fact table のみから差分を導出することで、projection 再構築時の整合性問題を回避する。

### 通知ルーター

`internal/notify/router.go` のパイプライン:

```
DiffEvents → SeverityFilter → Dedup → Channel.Send (with retry) → DeliveryLog
```

- **Severity filter**: event severity >= channel の threshold のみ送信（critical > high > medium > low）
- **Dedup**: `sha256(targetID + advisoryID + diffKind + YYYY-MM-DD)` で日次重複を排除
- **Retry**: exponential backoff (1s → 5s → 30s)、最大 3 回
- **配信ログ**: `notification_delivery_log` に成功/失敗を記録

通知チャネルは `Channel` interface で抽象化:
- **Slack**: Block Kit 形式、severity で色分け（critical=赤, high=橙, medium=黄, low=灰）
- **Discord**: Embed 形式、同様の色分け
- **Generic webhook**: 設定可能な method/headers + JSON body

メッセージには target 名、advisory ID、パッケージ名/version、DECREE Score、EPSS、exploit 有無、fix 候補を含む。

### main.go 統合

各コンポーネントを goroutine で並行起動し、`context.WithCancel` + `sync.WaitGroup` で graceful shutdown を実現:

1. Config 読み込み
2. DB pool + Redis client 接続
3. Scanner Connect-RPC client 作成
4. Diff engine + Notification router 組み立て
5. Scheduler goroutine 起動
6. Stream consumer goroutine 起動（`diff.enabled: true` 時のみ）
7. Health server 起動
8. SIGINT/SIGTERM → context cancel → 全 goroutine 待ち合わせ

### Redis consumer group の追加

`scripts/init-redis.sh` に以下を追加:

- `oracle-diff`: `scan-events` stream 上の oracle 用 consumer group
- `gateway-sse`: `finding-events` / `notification-events` stream 上の gateway 用 consumer group（M4 以降で使用）

## 代替案

### 代替案 1: `buf generate` + `connectrpc.com/connect` で Go クライアント自動生成

buf の Connect-Go プラグインで型安全なクライアントスタブを生成する方法も検討した。しかし、scanner 側は pbjson による camelCase JSON シリアライゼーションを行っており、Connect-Go クライアントが期待するフィールド名と一致するか検証が必要だった。unary RPC が 6 エンドポイントのみで型も単純なため、手動定義型 + `net/http` の方がデバッグしやすく依存も少ないと判断した。将来的にエンドポイントが増えた場合は再検討する。

### 代替案 2: diff 検出を projection table (`current_finding_status`) から行う

projection table の `is_active` フラグを前後で比較する方が SQL がシンプルになる。しかし、projection table は scanner 側で非同期に更新されるため、scan 完了イベント受信時点で projection が最新化されている保証がない。fact table（`vulnerability_observations` / `vulnerability_disappearances`）から直接導出する方が、タイミング依存を排除でき確実である。

### 代替案 3: 通知に外部メッセージキュー（SQS, Pub/Sub）を使用

Redis Streams の代わりに専用のメッセージキューサービスを使う方法も考えられた。しかし、DECREE は既に Redis Streams を scanner のイベント配信に使用しており、新たなインフラ依存を追加する理由がなかった。Redis Streams の consumer group + XACK による at-least-once 配信は、通知のユースケースに十分である。

## 影響・トレードオフ

### メリット

- **運用統合**: `decree.yaml` にターゲットと通知先を宣言的に設定するだけで、定期スキャン + 差分通知が自動化される
- **fact ベース差分検出**: projection table に依存しないため、projection の再構築やタイミング問題の影響を受けない
- **排他リース**: 複数 oracle インスタンスの水平スケール時に、同一ターゲットの重複スキャンを防止する
- **通知重複排除**: 日次 dedup key + delivery log により、同じ脆弱性の通知が 1 日に複数回送信されることを防ぐ
- **依存の最小化**: Connect-RPC クライアントを `net/http` + `encoding/json` で実装し、外部 RPC ライブラリへの依存を回避

### デメリット・リスク

- **手動型定義の保守**: scanner の proto 変更時に oracle 側の `types.go` を手動で追従する必要がある。フィールド追加時の見落としリスクがある
- **enrichment refresh の同期的呼び出し**: EPSS/NVD 同期は scanner の RPC を同期的に呼ぶため、同期中は他の enrichment が待機する。並行実行の実装は M4 以降の課題
- **初回スキャンの全ターゲット同時発行**: ターゲット数が多い場合、初回起動時に scanner に負荷が集中する。段階的な発行は未実装

### パフォーマンスへの影響

- **DB**: `job_leases` は target ごとに 1 行のため、行数はターゲット数に比例し数十〜数百程度。`notification_delivery_log` は日次 dedup で増加するが、定期的なアーカイブは未実装
- **Redis**: `XREADGROUP BLOCK 5000 COUNT 10` で 5 秒ごとのポーリング。イベント数が少ない通常運用では Redis への負荷は無視できる
- **スキャンパイプライン**: oracle はスキャンのトリガーとステータスポーリングのみを行い、実際のスキャン処理は scanner に委譲する。oracle 自体の CPU/メモリ使用量は最小限

## 今後の課題

- **段階的初回スキャン**: ターゲット数に応じた分散発行（jitter + rate limit）
- **通知テンプレートのカスタマイズ**: `decree.yaml` でメッセージフォーマットを定義可能にする
- **delivery log の retention**: 古い配信ログの自動削除 or アーカイブ
- **enrichment refresh の並行実行**: EPSS/NVD/ExploitDB を並行に同期し、完了後にまとめて recalculate
- **`buf generate` への移行検討**: エンドポイント追加時に手動型定義の保守コストが増える場合
- **gateway との SSE 連携**: `finding-events` / `notification-events` stream を gateway が `gateway-sse` consumer group で消費し、フロントエンドにリアルタイム配信（M4）

## 関連する ADR

- ADR-0002: decree-scanner M1 — SBOM・OSV パイプライン
- ADR-0003: decree-scanner M2 — Scoring Enrichment（EPSS/NVD/ExploitDB、DECREE Score）
- ADR-0004: decree-scanner tonic → Connect-RPC 移行（oracle クライアントが接続するプロトコル）
