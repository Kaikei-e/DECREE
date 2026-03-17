# ADR-0031: OSV affected range のクライアントサイド検証によるスキャナ偽陽性フィルター

## ステータス

Accepted

## 日付

2026-03-17

## コンテキスト

DECREE scanner は OSV.dev の batch API を使用して脆弱性を照合している。このフローでは、SBOM から抽出したパッケージ情報を OSV に送信し、返却された脆弱性リストを hydrate（個別 API で詳細取得）した後、そのまま DB に記録していた。

しかし、OSV の応答には `affected[].ranges[].events[]` に `introduced`/`fixed` のバージョン範囲が含まれているにもかかわらず、DECREE はこの情報を **fix_versions の表示抽出にしか使用しておらず、クエリ対象パッケージのバージョンが実際に影響範囲内かどうかの検証を一切行っていなかった**。

具体的な問題として、あるパッケージの修正済みバージョンが advisory の affected range（`fixed` で指定されたバージョン）を超えているにもかかわらず、OSV の応答に含まれていたために DECREE がそのまま脆弱性として記録・表示する偽陽性（false positive）が確認された。例えば、`fixed` が `1.20.0` に設定されている advisory に対して `1.20.1` が影響ありとして返却されるケースである。

これは OSV API がバージョンマッチングをサーバサイドで行う設計であるものの、advisory データ自体の品質問題や OSV のマッチングロジックの不具合により、誤った結果が返される可能性があることを意味する。DECREE がこれを無検証で信頼していたことが根本原因である。

## 決定事項

hydrate 後のパイプラインに**クライアントサイドの affected range 検証フィルター**を追加する。クエリ対象バージョンが affected range 外であることが確定できる場合のみ結果を除外し、判定不能な場合は保守的に「影響あり」として残す（偽陰性を作らない）。

## 実装の概要

### スキャンパイプライン上の位置づけ

```
SBOM生成 → OSV batch query → hydrate → [★ affected range 検証] → EPSS付与 → DECREE Score算出 → 分類
```

新たに追加されたフィルターは hydrate（詳細取得）の直後、DB 永続化の前に位置する。hydrate によって `affected` フィールドが埋まった状態でなければ range 判定ができないため、この位置が必然的に決まる。

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `services/scanner/Cargo.toml` | `semver = "1"` クレートを依存に追加 |
| `services/scanner/src/osv/mod.rs` | `pub mod version;` でモジュール登録 |
| `services/scanner/src/osv/version.rs` | バージョン比較ロジック `is_version_affected()` と 14 件のテスト（新規作成） |
| `services/scanner/src/osv/client.rs` | `filter_unaffected()` 関数追加、`query_batch()` 末尾で呼出、診断ログ追加 |

### `is_version_affected()` のアルゴリズム

OSV spec に準拠した range 判定を行う:

1. パッケージバージョンを `semver::Version` としてパース（lenient: `v` prefix 除去、2-part → 3-part パディング）
2. `affected` エントリからパッケージ名・ecosystem が一致するものを抽出
3. 各 range の events を順に走査し、`is_affected = false` で開始:
   - `introduced` イベント: `version >= introduced` なら `is_affected = true`
   - `fixed` イベント: `version >= fixed` なら `is_affected = false`
4. いずれかの range で affected と判定されれば `true` を返す

### 保守的フォールバック（偽陰性防止）

以下のケースではフィルターを適用せず、脆弱性を保持する:

- パッケージバージョンが semver としてパースできない
- range 内のバージョン文字列がパースできない（`"0"` センチネルは特別扱い）
- range type が `GIT` など semver 比較不能な型
- `affected` リストが空（advisory データ不足）
- `affected` エントリに `package` 情報がない

### 診断ログ

- `info!` レベル: 偽陽性としてフィルターされた脆弱性（vuln_id, package, version, ecosystem）
- `debug!` レベル: OSV クエリ構築時の PURL / name+ecosystem+version、除外数サマリー

デフォルトの `info` ログレベルでは、フィルター発動時のみログが出力される。`RUST_LOG=decree_scanner=debug` で詳細なクエリログが確認可能。

### データモデルへの影響

本変更はスキャンパイプラインのフィルタリングロジックのみに影響し、データモデル（fact / resource / projection）の構造変更はない。Atlas migration の追加も不要。フィルターは DB 永続化の前段で動作するため、偽陽性が DB に到達しなくなるという挙動変更のみ。

## 代替案

### 代替案 1: OSV の応答をそのまま信頼し続ける

OSV はバージョンマッチングをサーバサイドで行う設計であり、本来はクライアントが再検証する必要はない。しかし、実際に偽陽性が発生しており、advisory データの品質に起因する問題は OSV 側の修正を待つだけでは解決できない。DECREE のユーザーにとって偽陽性は信頼性の低下に直結するため、クライアントサイドでの防御層が必要と判断した。

### 代替案 2: 独自の脆弱性データベースを構築する

OSV への依存を排除し、NVD/GHSA から直接データを取得・管理する方式。データの鮮度管理、マルチエコシステム対応、バージョン範囲の正規化など、膨大な実装コストが発生する。DECREE の差別化ポイントはスコアリングと可視化であり、脆弱性データの一次収集は OSV に委ねるのが合理的。クライアントサイド検証という最小限の防御層で十分と判断した。

### 代替案 3: DB 永続化後にバックグラウンドで検証・除外する

一旦すべてを記録した上で、非同期ジョブで affected range を検証して `current_finding_status.is_active` を false にする方式。fact table（`vulnerability_observations`）には偽陽性の観測も残るため監査証跡として有用だが、ユーザーに一時的に偽陽性が表示されるという UX 上の問題がある。パイプライン内での即時フィルターを優先した。

## 影響・トレードオフ

### メリット

- OSV の応答品質に起因する偽陽性を、パイプライン内で即座に除外できる
- 保守的な設計により偽陰性のリスクを最小化（判定不能時は脆弱性を保持）
- 既存のデータモデル・スキーマに影響しない非侵襲的な変更
- `info!` ログにより、フィルター発動を運用時に追跡可能

### デメリット・リスク

- semver でパース可能なバージョン体系にのみ有効。PEP 440（Python）、Maven バージョニング、Go の pseudo-version などエコシステム固有のバージョン体系には対応していない。ただし、これらのケースでは保守的に「影響あり」として扱うため、偽陰性は発生しない
- OSV の `ECOSYSTEM` range type は本来エコシステム固有のバージョン比較が必要だが、現実装では semver として比較している。多くの主要エコシステム（npm, crates.io, PyPI の大半）は semver 互換であるため実用上の問題は少ない

### パフォーマンスへの影響

`semver::Version::parse` と range 判定は CPU バウンドの軽量処理であり、hydrate の HTTP 往復（数百〜数千件の個別 API コール）と比較して無視できるオーバーヘッド。パイプライン全体のスループットへの影響はない。

## 今後の課題

- **エコシステム固有バージョン比較の拡張**: PEP 440（PyPI）、Maven バージョニングなど、semver 以外のバージョン体系への対応。`semver` クレートの lenient パースでカバーできない範囲を特定し、必要に応じてエコシステム別のパーサーを追加する
- **`last_known_affected` イベントへの対応**: OSV spec には `fixed` の他に `last_known_affected` イベントがある。現実装ではこれを考慮していないため、対応が必要になる可能性がある
- **フィルター統計のメトリクス化**: フィルターの発動頻度を Prometheus メトリクスとして公開し、OSV データ品質の傾向を可視化する

## 関連するADR

- ADR-0028: EPSS prefetch と advisory snapshot — hydrate 後のパイプライン拡張ポイントとして関連
