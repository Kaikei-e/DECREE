# ADR-0003: decree-scanner M2 — Scoring Enrichment (NVD / EPSS / Exploit-DB)

## ステータス

Accepted

## 日付

2026-03-15

## コンテキスト

M1 完了後、scanner は SBOM 生成 → OSV 照合 → gRPC サービスのパイプラインが動作しているが、DECREE Score は暫定値 `CVSS × 0.4` のみで EPSS・Reachability 成分が欠落していた。正式な DECREE Score 式は以下の通り:

```
DECREE Score = (CVSS_base × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 0.25)
```

完全なスコアを算出するには以下の外部データソースとの統合が必要だった。

### EPSS（Exploit Prediction Scoring System）

FIRST が提供する API（`api.first.org/data/v1/epss`）から CVE ごとの exploit 確率とパーセンタイルを取得する。日次更新されるため、スキャンのたびに呼ぶのではなく独立した同期ジョブとして設計する必要があった。

### NVD（National Vulnerability Database）

OSV は CVSS スコアを必ずしも返さない。NVD API 2.0 から CVSS v3.1 スコア・ベクタを補完することで、OSV のみに依存しないスコアリングが可能になる。NVD API にはレート制限（API キーなし: 5req/30s、あり: 50req/30s）があり、制御が必須だった。

### Exploit-DB

公知 exploit の存在は脆弱性の実質的リスクを左右する。GitLab ミラーの `files_exploits.csv` から CVE ↔ Exploit の紐付けを取り込み、`exploit_source_items` / `exploit_cve_links`（M0 で定義済み）に永続化する。

### Reachability

DECREE Score の Reachability 成分は、ターゲットの `exposure_class`（public / internal / batch）と依存パスの深度（direct / transitive + depth）から近似計算する。静的解析ベースの到達可能性判定は将来の拡張として設計を残しつつ、M2 ではルールベースの近似を採用する。

### 設計原則: Enrichment は Scan Path と分離する

NVD / EPSS / Exploit-DB はスキャンのたびに引くのではなく、独立したジョブとして実行する。これにより:
- スキャンのレイテンシに外部 API の応答速度が影響しない
- EPSS データ更新後にスコアを再計算できる（再スキャン不要）
- NVD のレート制限にスキャン頻度が制約されない

## 決定事項

Enrichment を scanner の独立モジュール `enrichment::*` として実装し、gRPC `EnrichmentService` 経由で oracle から呼び出せるようにする。スキャンパイプラインは enrichment テーブルにキャッシュ済みデータがあればそれを使い、なければ NULL で書き込む（次回 enrichment ジョブで補完）。

## 実装の概要

### パイプラインへの影響

```
SBOM生成 → OSV照合 → EPSS lookup(キャッシュ) → Reachability計算 → DECREE Score算出 → 分類
                         ↑                           ↑
                    advisory_epss_snapshots      targets.exposure_class
                    (enrichment ジョブで事前投入)    + pkg.is_direct / dep_depth
```

スキャンパイプライン自体は外部 API を呼ばず、DB の enrichment テーブルから既存データを lookup するのみ。

### モジュール構成

```
services/scanner/src/enrichment/
├── mod.rs              # サブモジュール宣言
├── score.rs            # decree_score(), reachability_score(), severity_label()
├── projection.rs       # ProjectionUpdater — スコア再計算ジョブ
├── epss/
│   ├── mod.rs
│   ├── client.rs       # FIRST EPSS API クライアント（100件チャンクバッチ）
│   └── types.rs        # EpssApiResponse, EpssEntry
├── nvd/
│   ├── mod.rs
│   ├── client.rs       # NVD API 2.0 クライアント（セマフォベースレート制御）
│   └── types.rs        # NvdCveResponse, NvdCve, CvssData 等
└── exploitdb/
    ├── mod.rs
    ├── sync.rs         # git clone/pull → CSV パース → DB 永続化
    └── types.rs        # ExploitRecord, CVE 抽出ロジック
```

### DECREE Score 計算 (`enrichment::score`)

I/O を含まない純粋関数として実装。14 テストで全パターンをカバー。

**Reachability ルール:**

| exposure_class | direct | score |
|---|---|---|
| public | true | 10.0 |
| public | false | max(6.0 − (depth−1)×0.5, 1.0) |
| internal | true | 5.0 |
| internal | false | max(3.0 − (depth−1)×0.5, 1.0) |
| batch | true | 3.0 |
| batch | false | max(2.0 − (depth−1)×0.5, 1.0) |
| unknown/None | * | 5.0 |

`severity_label` は DECREE Score（CVSS ではなく）に基づくラベル付けに変更。M1 の `severity_from_cvss` / `provisional_decree_score` は deprecated とし、既存テストの互換性を維持。

### データモデル変更

4 テーブルを追加。Atlas migration `20260315200000_m2_enrichment_tables.sql` として追加。

**resource table 追加:**

```sql
-- Advisory メタデータキャッシュ
advisories (advisory_id, source, raw_json, fetched_at)
  UNIQUE (advisory_id, source)

-- CVE↔GHSA↔OSV 相互参照
advisory_aliases (advisory_id, alias)
  UNIQUE (advisory_id, alias)
```

**fact table 追加 (INSERT ONLY):**

```sql
-- NVD CVSS スナップショット
advisory_cvss_snapshots (cve_id, cvss_version, cvss_score, cvss_vector, source, fetched_at)
  UNIQUE (cve_id, source)

-- EPSS スナップショット
advisory_epss_snapshots (cve_id, epss_score, epss_percentile, epss_date, fetched_at)
  UNIQUE (cve_id, epss_date)  -- 日次重複防止
```

fact table の設計原則（INSERT ONLY）を維持: CVSS/EPSS スナップショットは `ON CONFLICT DO NOTHING`（EPSS）または `DO UPDATE SET fetched_at` で更新。時系列データとして蓄積し、過去のスコア変遷を追跡可能にする。

### NVD クライアントのレート制御

tokio `Semaphore` ベースのトークンバケット方式を採用:
- API キーあり: 50 permits / 30 秒
- API キーなし: 5 permits / 30 秒
- permit 取得後、`tokio::spawn` で 30 秒後に release
- 403/429 レスポンスはエラーとして返し、呼び出し元でスキップ + warn ログ

キャッシュ戦略: `advisory_cvss_snapshots` に 7 日以内のエントリがあれば NVD API をスキップ。

### EPSS クライアントのバッチ取得

FIRST EPSS API は `?cve=CVE-...,CVE-...` で最大 100 件ずつバッチ取得可能。`sync_known_cves` は `vulnerability_instances` の全 CVE-* ID を取得し、チャンク分割して一括同期する。

### Exploit-DB 同期

1. GitLab 公式ミラー（`gitlab.com/exploit-database/exploitdb.git`）を shallow clone / pull
2. `files_exploits.csv` を `csv` crate でパース
3. `exploit_source_items` に INSERT（既存 M0 テーブル）
4. `codes` カラムから CVE-* を正規表現抽出 → `exploit_cve_links` に INSERT
5. 新規リンク発生時に outbox イベント `exploit.linked` を発行

### Projection 更新器

`ProjectionUpdater::recalculate_all()` / `recalculate_for_cves()`:
1. active な `current_finding_status` を取得
2. 最新 `advisory_epss_snapshots` から EPSS を lookup
3. `targets.exposure_class` + observation の `is_direct_dep` / `dep_depth` から reachability 計算
4. `enrichment::score::decree_score()` で再計算
5. `current_finding_status` UPDATE
6. outbox イベント `scores.recalculated` を発行

### gRPC EnrichmentService

```protobuf
service EnrichmentService {
  rpc SyncEpss(SyncEpssRequest) returns (SyncEpssResponse);
  rpc SyncNvd(SyncNvdRequest) returns (SyncNvdResponse);
  rpc SyncExploitDb(SyncExploitDbRequest) returns (SyncExploitDbResponse);
  rpc RecalculateScores(RecalculateScoresRequest) returns (RecalculateScoresResponse);
}
```

Oracle が `decree.yaml` の `vulnerability_refresh` スケジュール（epss: 24h, nvd: 6h）に従ってこれらの RPC を呼ぶ。

### Redis Streams イベント追加

| ストリーム | イベント | ペイロード |
|---|---|---|
| `enrichment-events` | `exploit.linked` | `{new_links}` |
| `enrichment-events` | `scores.recalculated` | `{updated_count}` |

### スキャンパイプライン変更

`pipeline.rs` の `run_core` を修正:
1. OSV 照合後、`advisory_epss_snapshots` から EPSS を lookup
2. `target.exposure_class` + `pkg.is_direct` / `pkg.dep_depth` で reachability 計算
3. `enrichment::score::decree_score()` で完全スコア算出
4. `vulnerability_observations` INSERT に `epss_score`, `epss_percentile`, `reachability` カラムを追加
5. EPSS データ未取得の場合は NULL（次回 enrichment ジョブで補完）

### テスト戦略

| テスト種別 | 対象 | テスト数 |
|---|---|---|
| score unit test | reachability × 全 exposure_class/direct/depth、decree_score 組み合わせ、severity_label | 14 |
| EPSS client test | レスポンスパース、チャンキング、エラーハンドリング（wiremock） | 4 |
| NVD client test | CVSS v3.1 パース、404、429、型構造体テスト（wiremock） | 5 |
| ExploitDB test | CSV パース、CVE 抽出、URL 生成 | 6 |
| 既存テスト | SBOM パーサー、OSV ヘルパー、統合テスト（回帰確認） | 10 |
| **合計** | | **39** |

## 代替案

### Enrichment をスキャンパイプライン内で同期的に実行する

スキャンのたびに NVD / EPSS API を叩く設計も考えられたが、以下の理由で却下:
- NVD のレート制限（API キーなしで 5req/30s）によりスキャンのレイテンシが秒〜分単位で増加する
- EPSS は日次更新のため毎スキャンで取得する必要がない
- enrichment データの取得失敗がスキャン全体を失敗させてしまう
- EPSS 更新時にスコア再計算するためだけに全ターゲットを再スキャンすることになる

分離設計により、スキャンは高速に完了し、enrichment は独立したペースで実行でき、スコア再計算は再スキャン不要になった。

### EPSS / NVD データを Redis にキャッシュする

Redis をキャッシュ層にする案も検討したが、却下:
- fact table（INSERT ONLY）として蓄積することでスコア変遷の時系列分析が可能になる
- Redis 障害時にキャッシュが失われる
- DB に永続化しておけば projection 再構築が容易
- advisory_epss_snapshots の `UNIQUE (cve_id, epss_date)` で日次重複を自然に防止できる

### Reachability を静的解析（call graph）で算出する

正確な到達可能性判定には call graph 解析が必要だが、以下の理由で M2 ではルールベース近似を採用:
- 言語ごとに異なる解析ツールが必要（Go: golang.org/x/vuln、Java: Eclipse Steady 等）
- すべてのターゲット型（コンテナイメージ含む）でソースコードが利用可能とは限らない
- exposure_class + dep_depth の近似でも 8 割の判断は妥当（public + direct = 10.0、batch + deep transitive = 1.0）
- 将来 M4 以降で静的解析を追加する場合、`reachability_score()` 関数のロジックを拡張するだけで済む設計にした

### Exploit-DB の代わりに exploit 情報を NVD の references から抽出する

NVD の references フィールドにも exploit リンクが含まれる場合があるが、Exploit-DB の CSV は構造化されており CVE との紐付けが明示的。また Exploit-DB は PoC コードの有無を直接示すため、「exploitable かどうか」の判断により有用。両方のソースを将来的に統合する余地を残しつつ、M2 では Exploit-DB を一次ソースとした。

## 影響・トレードオフ

### メリット

- **完全な DECREE Score 算出**: 3 成分（CVSS × 0.4 + EPSS × 100 × 0.35 + Reachability × 0.25）すべてが計算可能に
- **Enrichment とスキャンの分離**: スキャンレイテンシに外部 API 応答が影響しない
- **再スキャン不要のスコア更新**: EPSS データ更新や exploit 発見時に `RecalculateScores` RPC で即座に反映
- **Fact table によるスコア履歴**: CVSS/EPSS スナップショットを時系列で蓄積し、スコア変遷の分析が可能
- **Graceful degradation**: NVD API キー未設定でも低レートで動作、EPSS 未取得でも CVSS + Reachability でスコア算出

### デメリット・リスク

- **初回スキャン時の不完全スコア**: enrichment ジョブが未実行の場合、EPSS 成分が 0 になる。oracle が scan 完了後に自動で enrichment → recalculate を呼ぶことで緩和
- **NVD API の不安定性**: NVD は過去にも長期ダウンタイムやレート制限強化を行っている。7 日キャッシュ TTL + 指数バックオフで緩和するが、長期障害時は CVSS が OSV 依存のみになる
- **Exploit-DB の git clone**: 初回 shallow clone でも数百 MB のダウンロードが発生する。Docker ボリュームにマウントしてコンテナ再起動時の再取得を回避する運用が必要
- **advisory_cvss_snapshots の UNIQUE 制約**: `(cve_id, source)` は同一ソースの最新値のみ保持する設計。NVD が CVSS を修正した場合は上書きされ、修正前のスコアは失われる。時系列保持が必要になった場合は制約を `(cve_id, source, fetched_at)` に変更する

### パフォーマンスへの影響

- **スキャンパイプライン**: EPSS lookup は `advisory_epss_snapshots` への 1 クエリ/finding の追加。observation INSERT カラム数が 3 増加するが、影響は軽微
- **EPSS 同期**: 典型的なプロジェクト（CVE 100〜500 件）は 1〜5 HTTP リクエストで完了（100 件/チャンク）
- **NVD 同期**: API キーありで 50req/30s。500 CVE の初回同期は約 5 分。キャッシュヒット後は数十秒
- **Projection 再計算**: active finding 数に線形比例。1000 findings で数秒程度（DB ラウンドトリップ支配）。将来的にバッチ UPDATE（CTE）で最適化可能

## 今後の課題

- **M3**: oracle → scanner の `EnrichmentService` RPC 呼び出し統合（decree.yaml スケジュール連携）
- **M3**: gateway から enrichment ステータスを SSE で配信
- **M4**: 静的解析ベースの Reachability（Go: golang.org/x/vuln 連携）で `reachability_score()` を拡張
- NVD CVSS 修正履歴の時系列保持（現在は最新値で上書き）
- EPSS パーセンタイルに基づく動的しきい値通知（例: 上位 1% に入った CVE を自動アラート）
- Exploit-DB 以外の exploit ソース統合（PacketStorm、PoC-in-GitHub）
- `advisory_aliases` テーブルを活用した CVE↔GHSA 相互参照による OSV/NVD データの統合

## 関連するADR

- [ADR-0002](ADR-0002-scanner-m1-sbom-osv-pipeline.md): M1 SBOM 正規化パイプラインと OSV バッチ照合（本 ADR の前提）
- [ADR-0001](ADR-0001-sveltekit-biome-pnpm.md): decree-eye のフロントエンド技術スタック
