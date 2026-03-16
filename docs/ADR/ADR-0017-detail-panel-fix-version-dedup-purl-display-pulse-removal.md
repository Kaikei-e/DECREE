# ADR-0017: DetailPanel表示バグ4件の修正（Fix Version重複・パス横スクロール・purlデコード・球体パルス削除）

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

脆弱性詳細パネル（DetailPanel）および3Dビジュアライゼーションにおいて、以下の4つの表示バグが報告された。

### Bug 1: Fix Versionの重複表示

`advisory_fix_versions` テーブルに `(instance_id, fixed_version)` のUNIQUE制約がなく、スキャンパイプラインが `INSERT` を実行するたびに同一の fix version 行が再挿入されていた。結果として、DetailPanel の「Fix Versions」セクションに `7.9.4` や `2.17.2` が数十回重複表示される状態となっていた。値自体は正しいが、UIの可読性を著しく損なっていた。

### Bug 2: Dependency Pathの横スクロール

DetailPanel の Dependency Path セクションで、パッケージ名が長い場合にパネル幅（`w-96`）を超えて横スクロールが発生していた。`flex` コンテナに `flex-wrap` が指定されていないことが原因。

### Bug 3: purlエンコーディングの未変換表示

SBOMから取得したpurl文字列（例: `pkg:npm/%40babel/helper-plugin-utils@7.26.5?package-id=cea54641331f9be3`）がパイプライン全体で変換されず、DetailPanel にそのまま表示されていた。`%40` が `@` にデコードされない、`?package-id=...` クエリパラメータが残るなど、開発者にとって読みづらい状態だった。

### Bug 4: 3D球体のブリージングアニメーション

ThreeSceneRenderer の `animate()` 内で、`pulse` フラグが立ったノードに対してサイン波による呼吸（breathing）アニメーションが適用されていた。視覚的なノイズとなっており、ユーザーから不要との報告を受けた。

## 決定事項

4つのバグをそれぞれ以下の方針で修正する:

1. **Fix Version重複**: DBスキーマにUNIQUE制約を追加し、scanner側で防御的dedup、gateway側でSELECT DISTINCTを適用する多層防御
2. **横スクロール**: CSSで `flex-wrap` を追加
3. **purlデコード**: 表示層（DetailPanel）でヘルパー関数によりpurlを人間可読形式に変換。DBにはpurl原文を保持する（データの正規形を維持）
4. **パルスアニメーション**: animate() から pulse 分岐を完全削除

## 実装の概要

### Bug 1: Fix Version重複 — 多層防御

**データモデル層（resource table: `advisory_fix_versions`）**

`db/schema.hcl` に UNIQUE インデックスを追加:

```hcl
index "uq_advisory_fix_versions" {
  columns = [column.instance_id, column.fixed_version]
  unique  = true
}
```

Atlas migration `20260316300000_unique_advisory_fix_versions.sql` で既存の重複行を削除した上で制約を適用。

**スキャンパイプライン（decree-scanner）**

`OsvVulnerability::extract_fix_versions()` で `sort()` + `dedup()` を適用し、OSVレスポンスに含まれる重複を源流で除去。

**API層（decree-gateway）**

`pg_store.go` の fix version 取得クエリを `SELECT DISTINCT fixed_version` に変更。DB側の制約が効いていない過渡期やマイグレーション前の既存データに対する防御。

### Bug 2: Dependency Path横スクロール

`DetailPanel.svelte` の依存パス各行の `<div>` に `flex-wrap` を追加。長いパッケージ名が自然に折り返されるようになった。

### Bug 3: purlデコード

`DetailPanel.svelte` に `formatPurl()` ヘルパー関数を追加:

```typescript
function formatPurl(purl: string): string {
  return decodeURIComponent(purl.replace(/^pkg:[^/]+\//, '').replace(/\?.*$/, ''));
}
```

処理の流れ: `pkg:<type>/` プレフィクス除去 → `?...` クエリパラメータ除去 → URIデコード（`%40` → `@`）

DBにはpurl原文を保持し続ける。purlはパッケージの一意識別子として正規形であり、表示層での変換が適切。

### Bug 4: 球体パルスアニメーション削除

`ThreeSceneRenderer.ts` から以下を削除:
- `PULSE_SPEED` 定数
- `animate()` 内の pulse 分岐（`if (node.visual.pulse) { ... }` ブロック全体）

ノードは常にrebuildScene時に設定された静的スケールで描画される。`pulse` プロパティは型定義上残存するが、レンダラーが参照しなくなるため実害はない。

## 代替案

### Bug 1: Fix Version重複

- **フロントエンドでの `[...new Set()]` による重複除去のみ**: DB側の肥大化を防げないため却下。根本原因はDB層にある
- **scanner の INSERT 時に `ON CONFLICT DO NOTHING`**: UNIQUE制約がなければ `ON CONFLICT` は機能しない。制約追加が先決であり、結局スキーマ変更が必要
- **DB制約のみ（scanner/gateway の変更なし）**: 多層防御の観点から、データ生成元と読み取り側の両方で対処するのが堅牢

### Bug 3: purlデコード

- **パイプラインの途中（scanner → DB書き込み時）でデコード**: purlの正規形が失われ、他のシステムとの相互運用性が低下するため却下
- **gateway 側でデコードしてAPIレスポンスに含める**: 将来的にpurl原文が必要なAPI消費者が出た場合に対応できなくなる。表示層での変換が最も柔軟

### Bug 4: パルスアニメーション

- **パルス速度の低減やオプション化**: ユーザーからの「不要」という明確なフィードバックを受け、完全削除がシンプル。将来再導入する場合は設定UIと合わせて実装すべき

## 影響・トレードオフ

### メリット

- Fix Versionの重複が解消され、DetailPanel の可読性が大幅に向上
- UNIQUE制約により `advisory_fix_versions` テーブルの肥大化を防止
- purlが人間可読形式で表示されるようになり、開発者が依存関係を直感的に把握可能
- パルスアニメーション削除により、3Dビューの視覚的ノイズが減少し、animate()ループの計算コストも軽減

### デメリット・リスク

- 既存の重複データをマイグレーションで削除するため、`DISTINCT ON` の選択基準（`id ASC` = 最も古いレコードを保持）が暗黙的。ただし fix version の値自体は同一なので、どの行を残しても機能上の差異はない
- `formatPurl()` はpurl仕様の全パターンを網羅していない簡易実装。`pkg:` プレフィクスを持たない非標準文字列が渡された場合、`decodeURIComponent` のみが適用される（安全側に倒れる）

### パフォーマンスへの影響

- UNIQUE制約のINSERT時オーバーヘッドは無視できる程度（B-treeインデックスの更新コスト）
- パルスアニメーション削除により、animate()ループ内でのノード全走査・Matrix4再計算・instanceMatrix更新が不要になり、大量ノード時のフレームレートが改善

## 今後の課題

- `pulse` プロパティの型定義からの除去（GraphModel / visual 型）を検討。現時点では他のレンダラー（Canvas2D、将来のWebGPU）が参照する可能性を残している
- `atlas.sum` の自動更新をCIに組み込む（現状はDocker内のatlasで手動ハッシュ更新）
- purlの表示形式をより洗練させる場合（バージョン部分のハイライト等）は、専用のpurlパーサーライブラリの導入を検討

## 関連するADR

- ADR-0013: eye 3Dレイアウトシフト・カメラフレーミング修正（ThreeSceneRenderer関連）
- ADR-0015: カメラツールバー・キーボードショートカット（ThreeSceneRenderer のUI改善）
