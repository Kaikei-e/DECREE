# ADR-0032: Detection Evidence — 脆弱性検出根拠の透明化

## ステータス

Accepted

## 日付

2026-03-17

## コンテキスト

ADR-0031 で導入した OSV affected range のクライアントサイド検証は、偽陽性を**除外する**フィルターとして機能していた。しかし、この設計には 2 つの透明性の課題があった:

1. **除外根拠の不可視性**: フィルターで除外された脆弱性について、なぜ除外されたかの根拠がユーザーに提示されなかった。除外判断はサーバサイドのログにのみ記録され、エンドユーザーには不可視だった
2. **保持根拠の不透明性**: 保守的に残された脆弱性（Inconclusive 判定）についても、「なぜ残したか」が不透明だった。ユーザーは DECREE が当該脆弱性をどの程度の確信度で検出したのか判断できなかった

脆弱性管理ツールに対するユーザーの信頼は、検出結果の正確性だけでなく、**判断プロセスの透明性**に大きく依存する。セキュリティエンジニアが DECREE の検出結果を受けてトリアージ・対応判断を行う際、「なぜこの脆弱性が報告されているのか」の根拠は不可欠な情報である。

関連コンポーネント: scanner（Rust）、gateway（Go）、eye（SvelteKit）

## 決定事項

ADR-0031 の「除外フィルター」を「3 値分類＋記録」モデルに置き換え、検出根拠（Detection Evidence）を API 経由でエンドユーザーに提示する。具体的には:

1. Scanner のフィルター方式を「偽陽性除外」から「3 値分類（SupportsMatch / ContradictsMatch / Inconclusive）＋ advisory snapshot 永続化」に変更
2. Gateway で advisory snapshot から `DetectionEvidence` 構造体を構築し、finding detail API 応答に含める
3. Eye の DetailPanel で検出根拠セクションを表示する

## 実装の概要

### スキャンパイプライン上の位置づけ

```
SBOM生成 → OSV batch query → hydrate → [★ 3値分類 + advisory snapshot 永続化] → EPSS付与 → DECREE Score算出 → 分類
```

ADR-0031 ではこの位置に「除外フィルター」があったが、本変更で「分類＋記録」ステップに置き換わった。脆弱性は除外されず、分類結果が advisory snapshot とともに DB に永続化される。ContradictsMatch の場合も finding は保持され、`warn!` ログが出力される。

### Scanner の変更

**`filter_unaffected()` の廃止と `classify_version_match()` の導入**

`osv/client.rs` から `filter_unaffected()` 関数を削除し、`osv/version.rs` に新たに `classify_version_match()` 関数を追加した。

```rust
pub enum RangeEvaluationStatus {
    SupportsMatch,       // affected range がバージョンの影響を肯定
    ContradictsMatch,    // affected range がバージョンの影響を否定
    Inconclusive,        // パース不能、データ不足等で判定不能
}
```

既存の `is_version_affected()` は `classify_version_match()` の薄いラッパーとして残し、後方互換性を維持している。

`evaluate_range_events()` の戻り値も `bool` から `Option<bool>` に変更し、パース失敗時に `None`（= Inconclusive）を明示的に返すようになった。

**`last_known_affected` イベントの対応**

ADR-0031 の「今後の課題」に挙がっていた `last_known_affected` への対応を実装。`version > last_known_affected` の場合に `is_affected = false` とする（境界値は inclusive）。

**advisory snapshot の永続化**

`scan/pipeline.rs` に `persist_osv_advisory_snapshot()` を追加。各脆弱性の hydrate 済み OSV レスポンスを `advisories` テーブルに UPSERT し、エイリアス（CVE-ID、GHSA-ID 等）を `advisory_aliases` テーブルに記録する。OsvVulnerability 型に `Serialize` を derive 追加し、JSON シリアライズを可能にした。

**DB クエリの追加**

`db/queries.rs` に以下を追加:
- `upsert_advisory()`: `advisories` テーブルへの UPSERT
- `insert_advisory_alias()`: `advisory_aliases` テーブルへの INSERT（ON CONFLICT DO NOTHING）

### Gateway の変更

**`advisory_evidence.go`（新規）**

DB に保存された advisory snapshot を再解析し、`DetectionEvidence` 構造体を構築するモジュール。

`newDetectionEvidence()` は以下を行う:
1. advisory の `raw_json` を Go 側の snapshot 型にデシリアライズ
2. `classifyRangeEvaluation()` でバージョン範囲を再評価（Scanner の Rust 実装と同等のロジックを Go で再実装）
3. summary、aliases、fetched_at とともに `DetectionEvidence` を返す

Go 側の range 評価はリクエスト時に毎回実行されるが、semver パースと比較のみの軽量処理であり、DB クエリ（advisory 取得）のオーバーヘッドの方が支配的。

**`models.go` の拡張**

`FindingDetail` に `DetectionEvidence` フィールドを追加:

```go
type DetectionEvidence struct {
    Source                string     `json:"source"`
    FetchedAt             *time.Time `json:"fetched_at,omitempty"`
    Summary               *string    `json:"summary,omitempty"`
    Aliases               []string   `json:"aliases"`
    RangeEvaluationStatus string     `json:"range_evaluation_status"`
}
```

**`pg_store.go` の拡張**

`GetFindingDetail()` に advisory snapshot と aliases の DB クエリを追加し、`newDetectionEvidence()` で構造体を構築してレスポンスに含める。

### Eye の変更

**`api.ts` の型追加**

```typescript
export interface DetectionEvidence {
    source: string;
    fetched_at?: string;
    summary?: string;
    aliases: string[];
    range_evaluation_status: 'supports_match' | 'contradicts_match' | 'inconclusive';
}
```

**`DetailPanel.svelte` の UI 追加**

Detection Evidence セクションを新設し、以下を表示:
- Source（例: `osv`）
- Fetched at（advisory 取得日時）
- Range evaluation status の人間可読メッセージ（`rangeStatusCopy()` 関数で変換）
- Advisory summary
- Aliases（CVE-ID、GHSA-ID 等をバッジ表示）

Range status のコピー例:
- `supports_match`: "OSV affected range supports this match."
- `contradicts_match`: "OSV range metadata disagrees with this version, but DECREE keeps the finding because source lag or metadata drift is possible."
- `inconclusive`: "DECREE could not conclusively evaluate the advisory range metadata for this package version."

### データモデルへの影響

スキーマ変更なし。既存の `advisories` テーブルと `advisory_aliases` テーブル（ADR-0028 で導入済み）を活用。Atlas migration の追加は不要。

### 変更ファイル一覧（13 ファイル）

| ファイル | 変更種別 | 変更内容 |
|---------|---------|---------|
| `services/scanner/src/osv/version.rs` | 変更 | `RangeEvaluationStatus` enum、`classify_version_match()`、`last_known_affected` 対応、`evaluate_range_events` → `Option<bool>` |
| `services/scanner/src/osv/types.rs` | 変更 | `Serialize` derive 追加、`published`/`modified` フィールド追加、`last_known_affected` の `#[serde(default)]` |
| `services/scanner/src/osv/client.rs` | 変更 | `filter_unaffected()` 削除、`is_version_affected` import 削除 |
| `services/scanner/src/scan/pipeline.rs` | 変更 | `classify_version_match` 呼出、`persist_osv_advisory_snapshot()` 追加、ContradictsMatch 時の `warn!` ログ |
| `services/scanner/src/db/queries.rs` | 変更 | `upsert_advisory()`、`insert_advisory_alias()` 追加 |
| `services/gateway/internal/db/advisory_evidence.go` | 新規 | Go 側 range 再評価ロジック、`newDetectionEvidence()` |
| `services/gateway/internal/db/advisory_evidence_test.go` | 新規 | `newDetectionEvidence` と `classifyRangeEvaluation` のユニットテスト |
| `services/gateway/internal/db/models.go` | 変更 | `DetectionEvidence` 構造体、`FindingDetail` フィールド追加 |
| `services/gateway/internal/db/pg_store.go` | 変更 | advisory snapshot・aliases の DB クエリ追加 |
| `services/gateway/internal/api/router_test.go` | 変更 | DetectionEvidence を含む finding detail のテスト追加 |
| `services/eye/src/lib/types/api.ts` | 変更 | `DetectionEvidence` TypeScript 型追加 |
| `services/eye/src/lib/components/DetailPanel.svelte` | 変更 | Detection Evidence UI セクション追加 |
| `services/eye/src/lib/components/DetailPanel.test.ts` | 新規 | DetailPanel の Detection Evidence 表示テスト |

## 代替案

### 代替案 1: Scanner でフィルター（除外）を継続し、フィルター理由をログのみに記録

ADR-0031 の設計を維持しつつ、除外理由の詳細ログを充実させる方式。実装コストは最小だが、ユーザーは DECREE の UI からフィルター判断を確認できず、サーバログへのアクセスが必要になる。セキュリティエンジニアがトリアージ時に確認できる形で根拠を提示するという目的を達成できないため却下した。

### 代替案 2: Gateway で advisory を都度 OSV API から取得して評価

DB に advisory snapshot を保存せず、finding detail リクエスト時に OSV API を呼び出してリアルタイムで評価する方式。データの鮮度は最高だが、外部 API 依存によるレイテンシ増加・障害時の不可用性が問題。スキャン時点の advisory データで判断したという事実を忠実に記録する方が、検出根拠としての信頼性が高いと判断した。

### 代替案 3: Range 評価を Scanner のみで行い、結果を DB カラムとして永続化

Scanner で算出した `RangeEvaluationStatus` を DB のカラムに保存し、Gateway は単にそれを返す方式。Gateway 側の再評価ロジックが不要になるが、advisory データの更新（OSV 側の修正）を反映するには再スキャンが必要になる。advisory snapshot を保存しておけば、Gateway がリクエスト時に最新のロジックで再評価できる柔軟性がある。将来的に評価ロジックが改善された場合にも再スキャンなしで反映されるため、snapshot ベースの方式を採用した。

## 影響・トレードオフ

### メリット

- 検出判断の透明性が向上し、セキュリティエンジニアのトリアージ判断を支援
- ContradictsMatch な finding も保持することで、偽陰性リスクを完全に排除（ADR-0031 では ContradictsMatch = 除外だった）
- advisory snapshot の永続化により、検出時点の根拠データが監査可能
- Gateway での再評価により、評価ロジックの改善が再スキャンなしで反映可能

### デメリット・リスク

- Scanner（Rust）と Gateway（Go）で range 評価ロジックが二重実装されている。両者の挙動の乖離がバグの原因になりうる。ただし、Scanner 側の分類はログ・診断用途であり、ユーザー向けの権威ある評価は Gateway 側が担う
- advisory snapshot の DB 保存によりストレージ使用量が増加する。ただし、advisory 数は脆弱性数と同等であり、実用上問題にならないレベル
- ContradictsMatch な finding を除外せず保持するため、ユーザーに表示される finding 数は ADR-0031 比で増加する可能性がある

### パフォーマンスへの影響

- Scanner: advisory snapshot の UPSERT と aliases の INSERT が脆弱性ごとに追加。DB 往復が増えるが、トランザクション内で実行されるため実質的なオーバーヘッドは軽微
- Gateway: finding detail リクエスト時に advisory テーブルと aliases テーブルへのクエリが追加。セマンティクス上 N+1 にはならず（finding 1 件に対して advisory 1 件）、レイテンシ影響は小さい
- Eye: DetectionEvidence セクションの追加は DOM ノード数の微増のみで、レンダリング性能への影響はない

## 今後の課題

- **Range 評価ロジックの Rust/Go 二重実装の解消**: 共通の評価仕様をテストケースで固定し、両言語の実装がドリフトしないようにする。あるいは Gateway を Rust に移行した際に統一する
- **DetectionEvidence の Eye 3D レンダラーへの反映**: ContradictsMatch な finding のノードを視覚的に区別する（透明度、色、アイコン等）
- **エコシステム固有バージョン比較の拡張**: ADR-0031 から引き続き、PEP 440 等の非 semver バージョン体系への対応
- **フィルター統計のメトリクス化**: 各分類の発生頻度を Prometheus メトリクスとして公開

## 関連するADR

- ADR-0028: EPSS prefetch と advisory snapshot — `advisories` / `advisory_aliases` テーブルの導入元
- ADR-0031: OSV affected range のクライアントサイド検証 — 本 ADR の前身。「除外フィルター」から「分類＋記録」への進化
