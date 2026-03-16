# ADR-0016: CVSS 4.0 スコア計算の正確化と severity_label 入力バグの修正

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

GHSA-mw96-cpmx-2vgc（CVE-2026-27606, Rollup パストラバーサル）の調査中に、decree-scanner のスコアリングパイプラインに **2つの重大なバグ** を発見した。

### バグ1: CVSS 4.0 近似計算が著しく不正確

`approximate_cvss4_score()` が `10.0 * exploitability * (impact / 6.0)` という素朴な線形積を使用していた。CVSS 4.0 は CVSS 3.x と異なり数式ベースではなく、FIRST.org が定義した約250エントリのルックアップテーブルとハミング距離補間によるスコアリング方式を採用している。線形積では非線形なメトリクス間の相互作用を捉えられず、実際のスコアと大幅に乖離していた。

CVE-2026-27606 のベクター `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N/E:P` に対して:

| 項目 | 旧計算 | FIRST.org 公式 |
|------|--------|----------------|
| スコア | 3.33 | ~8.7 |
| 深刻度 | Low | High |

原因は、6つのインパクトメトリクス（VC/VI/VA/SC/SI/SA）を等価に線形合算し全体を6で割っていたため、VC:H/VI:H/VA:N のようなケースで impact = 2.0/6.0 = 0.33 と過小評価されていた。公式アルゴリズムでは Confidentiality/Integrity への High は Availability への High より重く扱われ、複数の High が組み合わさると非線形に重みが増す。

### バグ2: `severity_label()` に DECREE Score を渡していた

`score::severity_label()` は関数コメントで "Map a **CVSS** score to a severity label" と記述されており、閾値も NVD 標準の CVSS スケール（0-10）に基づく 9.0/7.0/4.0 を使用している。しかし、実際の呼び出し箇所2か所（`pipeline.rs:141`, `projection.rs:146`）では DECREE Score を渡していた。

DECREE Score の範囲は 0〜41.5（CVSS×0.4 + EPSS×100×0.35 + Reachability×0.25）であり、EPSS 未取得時の最大値は 6.5 にとどまる。このため "high"（≥7.0）や "critical"（≥9.0）に到達することが構造的に不可能だった。

DB 上の severity 分布は `low: 18, medium: 15, unknown: 8` で、high/critical が 0件という異常な状態だった。

## 決定事項

1. CVSS 4.0 のスコア計算を、自前の線形近似から `cvss` クレート v2.2.0 の v4 モジュール（FIRST.org 公式ルックアップテーブル実装）に置き換える
2. `severity_label()` の入力を DECREE Score から CVSS ベーススコアに修正する
3. DECREE Score の公式自体は変更しない（CLAUDE.md の core invariant）

## 実装の概要

### 修正1: CVSS 4.0 スコア計算（`services/scanner/src/osv/types.rs`）

60行の `approximate_cvss4_score()` を4行の `compute_cvss4_score()` に置き換えた:

```rust
fn compute_cvss4_score(vector: &str) -> Option<f32> {
    let v4: cvss::v4::Vector = vector.parse().ok()?;
    let score = cvss::v4::Score::from(&v4);
    Some(score.value() as f32)
}
```

`cvss` クレート v2.2.0 は既に `Cargo.toml` の依存関係に含まれており、`cvss::v4` モジュールが FIRST.org 公式アルゴリズム（MacroVector 導出 → ルックアップテーブル参照 → ハミング距離補間）を実装している。新たな依存関係の追加は不要だった。

戻り値を `f32` から `Option<f32>` に変更し、パース失敗時に `None` を返すようにした。これにより不正なベクター文字列に対するエラーハンドリングも改善されている。

### 修正2: severity_label の入力修正

**`services/scanner/src/scan/pipeline.rs:141`**（スキャン時の新規観測）:

```rust
// Before: let severity = score::severity_label(decree_score);
let severity = score::severity_label(cvss);
```

**`services/scanner/src/enrichment/projection.rs:146`**（プロジェクション再計算）:

```rust
// Before: let new_severity = score::severity_label(new_score);
let new_severity = score::severity_label(finding.cvss_score);
```

両箇所とも、CVSS ベーススコアはスコープ内に既に存在しており、引数の差し替えのみで完結する。

### データモデルへの影響

変更は **projection 層**（`current_finding_status.last_severity`）と **fact 層**（`vulnerability_observations.severity`）の格納値に影響する。スキーマ変更は不要。

デプロイ後に `ProjectionUpdater::recalculate_all()` をトリガーすることで、既存データの `current_finding_status` が正しい severity に更新される。fact table（`vulnerability_observations`）の過去レコードは INSERT ONLY のため変更されないが、次回スキャン時に正しい severity で新規レコードが挿入される。

### テスト

CVSS 4.0 のテストケースを FIRST.org 公式計算機で検証したスコアに基づいて更新:

| ベクター | 旧テスト条件 | 新テスト条件 |
|----------|-------------|-------------|
| VC:H/VI:H/VA:H（高インパクト） | `> 4.0` | `~9.3 ± 0.2` |
| CVE-2026-27606 相当 | なし | `~8.7 ± 0.5`（新規追加） |
| AT:P/PR:L/VA:L（低インパクト） | `< 3.0` | `< 4.0` |
| 全メトリクス N（ゼロインパクト） | `== 0.0` | `== 0.0` |

全52テスト + 1統合テストが通過。`cargo clippy -- -D warnings` もクリーン。

## 代替案

### CVSS 4.0: 自前でルックアップテーブルを実装する

FIRST.org のリファレンス実装（JavaScript, ~600行）を Rust にポートする案。正確なスコアが得られるが、`cvss` クレートが既に同じアルゴリズムを実装しており依存関係にも含まれていたため、車輪の再発明になる。却下。

### CVSS 4.0: 線形近似の改良

インパクトメトリクスに非線形の重み付け（C/I を A より重くするなど）を導入して近似精度を上げる案。しかし CVSS 4.0 のスコアリングはルックアップテーブル方式であり、どれだけ近似を精緻化しても全ケースでの正確性は保証できない。公式実装が利用可能な以上、近似に固執する理由がない。却下。

### severity_label: DECREE Score 用の閾値を別途定義する

DECREE Score の範囲（0〜41.5）に合わせた閾値（例: critical ≥ 33, high ≥ 21）を定義する案。EPSS の有無でスコア範囲が劇的に変わる（max 6.5 vs 41.5）ため、単一の閾値セットでは適切に分類できない。また severity は業界標準で CVSS ベースの分類が広く使われており、通知フィルタリング（oracle の `severity_threshold`）やフロントエンドの色分け（eye の `SEVERITY_COLORS`）との一貫性も損なわれる。却下。

## 影響・トレードオフ

### メリット

- CVSS 4.0 のスコアが FIRST.org 公式アルゴリズムと一致するようになる
- severity 分布が正常化し、high/critical が適切に分類される
- oracle の通知フィルタリング（`severity_threshold: high` 等）が正しく機能する
- eye の可視化でノードの色分けが severity を正確に反映する

### デメリット・リスク

- fact table（`vulnerability_observations`）の過去レコードには旧計算の severity が残る。再スキャンまで歴史データとの不整合が生じる
- `cvss` クレートの v4 実装に依存するため、FIRST.org がルックアップテーブルを改訂した場合はクレートの更新が必要

### パフォーマンスへの影響

`cvss` クレートの v4 スコア計算はルックアップテーブル参照と軽量な補間演算のため、旧実装の線形積と比較して実質的なパフォーマンス差はない。スキャンパイプライン全体のボトルネック（ネットワーク I/O: OSV/NVD API 呼び出し）と比較して無視できる。

## 今後の課題

- デプロイ後に `ProjectionUpdater::recalculate_all()` を実行し、`current_finding_status` の全レコードを正しい severity に更新する必要がある
- DECREE Score の範囲（0〜41.5）が CVSS の 0-10 スケールと異なる点は別途検討が必要（EPSS × 100 のスケーリングが意図通りかの確認）
- `cvss` クレートのメジャーアップデート時に v4 スコアリングの互換性を検証するテストを維持する

## 関連するADR

- なし（DECREE Score 公式は本 ADR では変更していない。公式変更が必要な場合は別途 ADR を起票する）
