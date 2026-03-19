# ADR-0034: EPSS 取得間隔を 24h から 12h に短縮

## ステータス

Accepted

## 日付

2026-03-20

## コンテキスト

DECREE は FIRST.org の EPSS API からスコアを定期取得し、`advisory_epss_snapshots` テーブルに保存している。この取得間隔は `decree.yaml` の `vulnerability_refresh.epss` で設定され、従来は `24h` であった。

FIRST.org EPSS API の仕様を調査した結果、以下の制約が判明した:

- **データ更新頻度**: 1日1回（"refreshed every day"）
- **レートリミット**: 認証なし 1,000 リクエスト/分
- **制限超過時**: `429 Too Many Requests` + 一時ブロック

EPSS データが1日1回しか更新されない以上、24h より大幅に高頻度（例: 1h）でフェッチしても新しいデータは得られない。DB の `UNIQUE(cve_id, epss_date)` 制約により、同日の重複フェッチは `ON CONFLICT DO NOTHING` で無視されるため実害はないが、無意味な API コールとなる。

一方、24h 間隔ではフェッチのタイミングが EPSS の更新タイミングと常にずれる可能性があり、フェッチ失敗時のリカバリも次の 24h 後まで待つ必要がある。

## 決定事項

EPSS 取得間隔を `24h` から `12h` に短縮する。コード変更は不要で、`decree.yaml` の設定値のみを変更する。

## 実装の概要

### 変更箇所

`decree.yaml` の `vulnerability_refresh.epss` を `24h` → `12h` に変更。

```yaml
vulnerability_refresh:
  epss: 12h   # was: 24h
  osv: 1h
  nvd: 6h
```

### 既存の仕組みとの整合

- **Oracle scheduler** (`services/oracle/internal/scheduler/scheduler.go`): `decree.yaml` から間隔を読み取り ticker を設定するため、コード変更不要
- **Scanner EPSS client** (`services/scanner/src/enrichment/epss/client.rs`): 100 CVE/リクエストのチャンク取得。間隔変更の影響なし
- **DB 制約**: `advisory_epss_snapshots` の `UNIQUE(cve_id, epss_date)` により、同日の 2 回目フェッチは `DO NOTHING` で無視される
- **起動時フェッチ**: ADR-0028 で実装済みの即時実行ロジックは変更不要

### スキャンパイプライン上の位置づけ

```
SBOM生成 → OSV/NVD照合 → EPSS付与 → DECREE Score算出 → 分類
                           ^^^^^^^^
                           この変更は EPSS のリフレッシュ頻度に影響する
```

DECREE Score の EPSS 成分（重み 0.35）の鮮度が間接的に向上する。

## 代替案

### 案1: 現状維持（24h）

EPSS の更新が1日1回である以上、24h で十分とも言える。ただし、フェッチ失敗時に次のリトライまで 24h 待つことになり、EPSS データの欠損期間が長くなるリスクがある。

### 案2: 高頻度化（1h〜6h）

技術的には可能だが、EPSS データが1日1回しか変わらないため、同日の大半のフェッチが `DO NOTHING` になる。API コールの無駄が増えるだけで、データ鮮度の実質的な向上はない。

### 案3: 指数バックオフ付きリトライ

フェッチ失敗時のみリトライする仕組み。より精密だが、12h 間隔で十分にカバーでき、実装コストに見合わない。

## 影響・トレードオフ

### メリット

- EPSS 更新タイミングとのずれを最大 12h に短縮（従来は最大 24h）
- フェッチ失敗時のリカバリが 12h 以内に自動で行われる
- 設定変更のみで実装リスクがゼロ

### デメリット・リスク

- EPSS API へのリクエスト数が約 2 倍になる（ただしレートリミット 1,000/分に対して無視できる量）
- 同日の 2 回目フェッチは DB で無視されるため、厳密にはリソースの無駄（ネットワーク + 軽微な CPU）

### パフォーマンスへの影響

実質的に無視できる。同日の重複データは DB の `ON CONFLICT DO NOTHING` で即座に破棄され、追加のストレージ消費やインデックス更新は発生しない。

## 今後の課題

- FIRST.org が EPSS の更新頻度を変更した場合、この間隔を再検討する
- FIRST 会員になった場合、レートリミット引き上げと合わせて取得戦略を見直す余地がある

## 関連するADR

- ADR-0028: スキャン時 EPSS プリフェッチと advisory_epss_snapshots ベースのクエリ統合
