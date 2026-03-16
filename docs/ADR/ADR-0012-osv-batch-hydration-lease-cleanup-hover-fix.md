# ADR-0012: OSV バッチ API ハイドレーション・リース残留修正・ホバー操作修正

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

ADR-0011 で CVSS ベクトルパースとカメラ中心化を実装したが、デプロイ後の検証で
3 つの問題が発見された:

### 問題 1: 全脆弱性のスコアが NULL

`current_finding_status` の `last_score` が全件 NULL、`last_severity` が全件
`'unknown'` のままだった。CVSS パースロジック（ADR-0011）は正しく実装されていたが、
**OSV バッチ API (`/v1/querybatch`) がスタブレスポンスしか返さない**ことが根本原因。

バッチ API のレスポンスは `{"id": "...", "modified": "..."}` のみで、`severity`・
`aliases`・`affected` フィールドを含まない。`OsvVulnerability` の `severity` は
`#[serde(default)]` で空ベクタにデシリアライズされるため、`extract_cvss_score()` は
常に `None` を返していた。

### 問題 2: 再スキャンがリース残留で発動しない

DB クリーンアップ後に `docker compose restart decree-oracle` を実行しても、
スキャンが開始されなかった。oracle のログには `"running initial scan for all targets"`
が出力されるが、`"triggering scan"` が出ない。

原因: `job_leases` テーブルに前インスタンスのリースが残留していた。
`AcquireLease` は `expires_at < now() OR holder_id = EXCLUDED.holder_id` でしか
上書きできないため、コンテナ再起動で `holder_id` が変わると TTL（20 分）が
切れるまでリースを取得できない。さらに `!acquired` 時のログが `slog.Debug` で
出力されていたため、デフォルトログレベルでは問題が不可視だった。

### 問題 3: ノードホバーでカメラが回転しクリックできない

Three.js の `OrbitControls` と `pointermove` ハンドラが同一 DOM 要素でイベントを
受け取り、ノード上でマウスを移動するとカメラが回転してクリックターゲットがずれる。
ADR-0011 で `dampingFactor` を 0.05→0.15 に変更したが不十分だった。

## 決定事項

1. **OSV バッチ API 結果のハイドレーション**: バッチ API で取得したスタブを
   個別 API (`/v1/vulns/{id}`) で完全な脆弱性情報に差し替える
2. **CVSS v4 サポート追加**: OSV が `CVSS_V4` タイプで返すアドバイザリに対応する
3. **リース起動時クリーンアップ**: oracle 起動時に期限切れリースを削除する
4. **リーススキップログレベル昇格**: `Debug` → `Warn` に変更し問題を可視化する
5. **ホバー時 OrbitControls 回転無効化**: ノードホバー中は `enableRotate = false`

## 実装の概要

### scanner: OSV ハイドレーション (`services/scanner/src/osv/client.rs`)

```
バッチ API → スタブ取得 → ユニーク ID 抽出 → 個別 API で詳細取得 → スタブ差し替え
```

`query_batch()` の末尾に `hydrate_results()` を追加。全スタブ脆弱性の ID を
収集し、`/v1/vulns/{id}` で個別にフェッチして `severity`・`aliases`・`affected`
を含む完全なレコードに差し替える。

フェッチは逐次実行（レートリミット回避）。個別フェッチ失敗時はスタブのまま維持し、
スコアは NULL になるが、スキャン全体は失敗しない。

### scanner: CVSS v4 サポート (`services/scanner/src/osv/types.rs`)

`extract_cvss_score()` を拡張:
- CVSS v3 を優先的に探索（従来通り）
- v3 が見つからない場合、`CVSS_V4` タイプにフォールバック
- v4 ベクトルからベースメトリクス（AV/AC/AT/PR/UI + VC/VI/VA/SC/SI/SA）を
  抽出し、exploitability × impact で 0-10 スケールのスコアを近似算出

`extract_cvss_vector()` も `CVSS_V4` を含むように拡張。

**v4 スコアの近似手法**: CVSS v4 の正式な計算は
[補足テーブルと macrovector マッピング](https://www.first.org/cvss/v4.0/specification-document)
を必要とする複雑な仕様であるため、ベースメトリクスの重み付け積で近似する。
DECREE Score は CVSS × 0.4 の係数で使用されるため、0-10 スケールでの
相対的な順序付けが維持されれば十分と判断した。

### oracle: リース起動時クリーンアップ (`services/oracle/internal/scheduler/scheduler.go`)

`Run()` の冒頭で `db.ClearExpiredLeases()` を呼び出し、`expires_at < now()` の
リースを削除する。

`triggerScan()` のリーススキップログを `slog.Debug` → `slog.Warn` に昇格。

### oracle: DB クエリ追加 (`services/oracle/internal/db/queries.go`)

`ClearExpiredLeases()`: `DELETE FROM job_leases WHERE expires_at < now()` を実行。
削除件数をログに出力。

### eye: ホバー時回転無効化 (`services/eye/src/lib/renderer/three/ThreeSceneRenderer.ts`)

`handlePointerMove` でノード ID を取得した際に
`this.controls.enableRotate = nodeId == null` を設定。
ノードホバー中はカメラ回転が無効化され、パン・ズームは維持される。
ノードから離れると自動的に回転が再有効化される。

### データモデルへの影響

- **fact table**: `vulnerability_observations` に書き込まれるスコアが NULL から
  実際の値に変わる。スキーマ変更なし
- **projection table**: `current_finding_status` の `last_score`・`last_severity`
  が正しく伝播される。スキーマ変更なし
- **resource table**: `job_leases` に対する起動時 DELETE を追加。運用操作のみ

Atlas migration の追加は不要。

## 代替案

### OSV バッチ API の代わりに個別 API のみ使用

パッケージごとに `/v1/query` を呼ぶ方式。577 パッケージで 577 回の API コールが
必要になり、レートリミットとレイテンシの観点で非現実的。バッチ API でヒットした
脆弱性のみ（今回は 36 件）を個別フェッチするハイブリッド方式を採用した。

### CVSS v4 の正式計算ライブラリ導入

Rust の CVSS v4 計算ライブラリは 2026-03 時点で成熟度が低い。
DECREE Score における CVSS の寄与率は 40% であり、v4 の正確なスコアと
近似スコアの差分が最終スコアに与える影響は限定的。将来的にライブラリが
安定したら差し替えを検討する。

### リース: Redis ベースへの移行

PostgreSQL の `job_leases` テーブルの代わりに Redis の `SET NX EX` を使う案。
TTL 管理が自動化されるが、現状のリースは単純な排他制御のみで、Redis への
移行コストに見合うメリットがない。起動時クリーンアップで十分対処可能。

### ホバー: Raycaster ベースのイベント分離

`OrbitControls` のイベントハンドラを差し替えてノード領域を除外する案。
OrbitControls の内部実装に依存するため保守性が低い。`enableRotate` フラグは
公式 API であり、最小限の変更で目的を達成できる。

## 影響・トレードオフ

### メリット

- 脆弱性スコアが正しく算出され、可視化で severity に応じた色分けと Y 軸分散が機能する
- oracle の再起動時にリースが残留してスキャンが停止する問題が解消
- ノードのホバー・クリック操作が安定し、脆弱性詳細の確認が可能になる
- CVSS v4 のみ提供するアドバイザリ（GHSA の新しいものに多い）もスコアリング対象になる

### デメリット・リスク

- OSV 個別 API への追加リクエスト: 36 件の脆弱性で約 13 秒の追加レイテンシ。
  脆弱性数が増えると線形に増加する
- CVSS v4 の近似スコアは正式計算と乖離する可能性がある。
  特に Supplemental/Environmental メトリクスを持つベクトルでは差が大きくなりうる
- `enableRotate = false` 中はノード上でのカメラ回転が不可能。ユーザーはノード外の
  領域でカメラを操作する必要がある

### パフォーマンスへの影響

- スキャンパイプライン: OSV ハイドレーションにより 1 スキャンあたり約 10-15 秒の
  追加時間。スキャン間隔（10 分）に対して十分小さい
- 可視化: `enableRotate` の切り替えはフレームレートに影響しない
- DB: `ClearExpiredLeases` は起動時の 1 回のみで、`job_leases` は通常 1 行

## 今後の課題

- OSV バッチ API が将来 severity を含むようになった場合、ハイドレーションを
  条件付きにして不要なリクエストを削減する
- CVSS v4 正式計算ライブラリの成熟を監視し、近似計算を置き換える
- リースの TTL 管理を改善: 現状は `2 * scan_interval` の固定 TTL だが、
  スキャン完了時に即座にリリースされるため問題は少ない。ただし、oracle が
  異常終了した場合は TTL 満了まで待つ必要がある
- OSV 個別フェッチの並行化: `tokio::task::JoinSet` で bounded concurrency を
  実装し、ハイドレーション時間を短縮する

## 関連するADR

- ADR-0011: CVSS ベクトルパース・カメラ中心化修正（本 ADR の前提となる修正）
- ADR-0009: OSV クエリのエコシステムフィルタ修正
