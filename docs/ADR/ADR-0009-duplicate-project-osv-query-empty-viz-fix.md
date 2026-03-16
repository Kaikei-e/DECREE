# ADR-0009: プロジェクト重複作成・OSV APIクエリ形式・空グラフUXの修正

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

本番相当環境で3つの連鎖する問題が発見された:

1. **プロジェクト重複作成**: `docker compose up` のたびに `projects` と `targets` に同名レコードが新規 INSERT され、重複が蓄積していた。確認時点で project "example" が10件、target は合計31件に膨れていた。根本原因は `projects` テーブルに `name` の UNIQUE 制約がなく、`targets` にも `(project_id, name)` の UNIQUE 制約がなかったこと。oracle の `ON CONFLICT` 句が制約を特定できず空振りしていた。

2. **OSV API クエリ失敗**: scanner が OSV batch API に送信するクエリで `purl` フィールドがトップレベルに配置されていた。OSV API v1 の仕様では `purl` は `package` オブジェクト内に期待されるため、全クエリが 400 "Invalid query" で失敗していた。

3. **3D可視化が空**: 上記2つの問題により有効なスキャン結果が `current_finding_status` に到達せず、eye が受け取るグラフモデルのノード数が常に0だった。グリッドだけが表示され、ユーザーには何が起きているか分からない状態だった。

これらは独立した問題だが、修正の効果は連鎖する: 重複解消 → スキャン対象の正規化 → OSV クエリ修正 → 脆弱性データ取得成功 → 可視化にノードが表示される。

## 決定事項

1. resource table (`projects`, `targets`) に UNIQUE 制約を追加し、oracle の upsert クエリを制約名指定に修正する
2. scanner の OSV クエリ構造体を OSV API v1 仕様に準拠させ、`purl` を `package` オブジェクト内に移動する
3. eye の `VisualizationCanvas` にグラフが空の場合のフィードバックメッセージを追加する

## 実装の概要

### 問題1: プロジェクト重複（resource table 層）

**スキーマ変更** (`db/schema.hcl`):
- `projects` テーブルに `idx_projects_name` (UNIQUE on `name`) を追加
- `targets` テーブルに `idx_targets_project_name` (UNIQUE on `project_id, name`) を追加

**Migration** (`db/migrations/20260316200000_unique_project_target_name.sql`):
- 既存の重複データを `DISTINCT ON` で最古のレコードのみ残して削除
- UNIQUE INDEX を作成

**Oracle クエリ修正** (`services/oracle/internal/db/queries.go`):
- `EnsureProject`: `ON CONFLICT DO NOTHING` → `ON CONFLICT (name) DO NOTHING` に変更。制約名を明示することで PostgreSQL が正しく conflict 判定を行う
- `UpsertTarget`: `ON CONFLICT ON CONSTRAINT targets_pkey DO NOTHING` → `ON CONFLICT (project_id, name) DO UPDATE SET target_type, source_ref, branch` に変更。`DO UPDATE` にすることで `decree.yaml` でターゲット設定を変更した場合にも反映される

### 問題2: OSV API クエリ形式（スキャンパイプライン: OSV/NVD照合ステージ）

**型定義修正** (`services/scanner/src/osv/types.rs`):
- `OsvQuery` からトップレベルの `purl` フィールドを削除
- `OsvQueryPackage` に `purl: Option<String>` を追加
- `OsvQueryPackage` の `name`, `ecosystem` を `Option<String>` に変更し、`skip_serializing_if` で None 時に省略

修正前のシリアライズ結果:
```json
{"queries": [{"purl": "pkg:golang/foo@1.0"}]}
```

修正後:
```json
{"queries": [{"package": {"purl": "pkg:golang/foo@1.0"}}]}
```

**クエリ構築修正** (`services/scanner/src/osv/client.rs`):
- purl パス: `OsvQueryPackage { purl: Some(...), name: None, ecosystem: None }` を生成
- ecosystem パス: `OsvQueryPackage { name: Some(...), ecosystem: Some(...), purl: None }` を生成

**テスト追加** (`services/scanner/src/osv/client.rs`):
- `osv_query_purl_serializes_inside_package`: purl が `package` 内にシリアライズされ、トップレベルに出ないことを検証
- `osv_query_ecosystem_path_serializes_correctly`: ecosystem パスで `name`, `ecosystem`, `version` が正しい位置に出ることを検証

### 問題3: 空グラフ UX（eye 可視化層）

**コンポーネント修正** (`services/eye/src/lib/components/VisualizationCanvas.svelte`):
- `graphModel.nodes.size === 0` の場合に `"No vulnerability data available"` メッセージをオーバーレイ表示
- `pointer-events-none` でキャンバスの操作を阻害しない
- Three.js WebGPURenderer / Sigma.js フォールバック双方で同じ条件で表示される（レンダラー初期化前にチェックされるため）

## 代替案

### 問題1: 重複防止

**案A: アプリケーション層での存在確認 (SELECT → INSERT)**
`INSERT` 前に `SELECT` で存在チェックする方法。TOCTOU 競合が発生しうるため不採用。DB 制約で保証する方が堅牢。

**案B: `ON CONFLICT ON CONSTRAINT targets_pkey` のまま fallback SELECT に依存**
現状の実装がこれ。`targets_pkey` は `id` (UUID) の制約なので `(project_id, name)` の重複を検出できない。新規 UUID が生成されるたびに INSERT が成功してしまう根本的な設計ミスだった。

### 問題2: OSV クエリ

**案A: purl を常に使用し、ecosystem パスを廃止**
SBOM パーサーが purl を出力しないケースがあるため不可。ecosystem フォールバックは維持する必要がある。

**案B: Unknown ecosystem のパッケージをフィルタ**
空文字列の ecosystem が OSV API を拒否する問題の回避策として検討した。しかし今回の修正で purl パスが正しく動作するようになれば、purl を持つパッケージは ecosystem に依存しない。Unknown ecosystem かつ purl なしのパッケージへの対処は今後の課題とした。

## 影響・トレードオフ

### メリット

- `docker compose up` を何度実行してもプロジェクト・ターゲットが1件ずつ維持される
- `decree.yaml` のターゲット設定変更（branch, source_ref 等）が再起動で反映される
- OSV batch API が正常にレスポンスを返し、脆弱性データが取得可能になる
- スキャン結果がない状態でもユーザーに状況が伝わる

### デメリット・リスク

- Migration で既存の重複データを削除するため、重複レコードに紐づく `scans`, `vulnerability_observations` 等の fact table レコードは CASCADE で削除される。ただし重複ターゲットのスキャンは全て失敗しているため、実質的なデータ損失はない
- `UpsertTarget` を `DO UPDATE` に変更したことで、意図せずターゲット設定が上書きされるリスクがある。ただし設定の正本は `decree.yaml` であり、DB は派生データという位置づけなので問題ない

### パフォーマンスへの影響

- UNIQUE INDEX の追加により INSERT 時にインデックス更新のオーバーヘッドが発生するが、ターゲット数は数十〜数百程度のため無視できる
- 重複ターゲットの解消により並行スキャン数が激減し（31件 → 3件）、scanner コンテナのリソース消費が大幅に改善する

## 今後の課題

- `Ecosystem::Unknown` かつ purl なしのパッケージが OSV batch クエリに含まれると空文字列の ecosystem で 400 エラーになる可能性が残る。バッチ送信前にフィルタリングするか、ecosystem マッピングを拡充する必要がある
- `example-api` (`ghcr.io/example/example-api:latest`) は存在しないイメージのためスキャンは常に失敗する。サンプル設定として残すか、`decree.yaml` から除外するか検討が必要
- scanner の git clone に並行数制限（セマフォ）がない。大量ターゲット環境では DNS 解決失敗やファイルディスクリプタ枯渇が起きうる

## 関連するADR

- ADR-0005: oracle M3 スケジューラ・差分検出・通知（oracle のスキャンスケジューリング設計）
- ADR-0008: eye WebGL コンテキストリーク修正（可視化レンダラーの安定性改善）
