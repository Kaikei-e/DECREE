# ADR-0033: Oracle での finding 解消時に projection table を同期更新する

## ステータス

Accepted

## 日付

2026-03-19

## コンテキスト

対応済みの脆弱性が UI 上で消えないというバグが報告された。フロントエンド (decree-eye) は `active_only=true` パラメータを gateway に送り、gateway は `current_finding_status.is_active = true` で SQL フィルタしている。しかし、脆弱性が解消されたときに `current_finding_status.is_active` を `false` に更新する処理がどこにも存在しなかった。

### 根本原因

DECREE のスキャンパイプラインにおいて、3 つのサービスがそれぞれ異なる責務を持つ:

1. **decree-scanner**: 観測された finding を `vulnerability_observations` に INSERT し、`current_finding_status` を `is_active = true` で UPSERT する
2. **decree-oracle**: 前回 scan にあり今回 scan にない finding を検知すると `vulnerability_disappearances` に INSERT するが、projection table (`current_finding_status`) は更新していなかった
3. **decree-gateway**: `current_finding_status.is_active` を WHERE 句でフィルタして UI に返す

結果として、一度 active になった finding は `current_finding_status.is_active = true` のまま残り続け、`active_only=true` フィルタで除外されなかった。

### データモデル上の位置づけ

影響を受けるのは以下の 2 層:

- **fact table** (`vulnerability_disappearances`): disappearance の記録は従来通り INSERT ONLY で変更なし
- **projection table** (`current_finding_status`): `is_active` フラグの UPDATE を追加。projection table は設計上 UPDATE が許可されている唯一のテーブルであり、fact table から再構築可能な導出データである

## 決定事項

### Phase 1: ResolveFinding トランザクション化

Oracle の diff engine が resolved finding を検知したタイミングで、`vulnerability_disappearances` への INSERT と `current_finding_status.is_active = false` への UPDATE を同一トランザクション内で実行する。

### Phase 2: Stale Data Backfill

Phase 1 の修正前に `vulnerability_disappearances` に記録されたが `current_finding_status.is_active` が更新されなかった不整合レコードを、Oracle 起動時に 1 回だけ走る backfill クエリで一括修正する。

## 実装の概要

### 変更対象サービス

decree-oracle のみ。スキーマ変更・Atlas migration は不要。

### DB 層: `ResolveFinding` メソッド

`services/oracle/internal/db/queries.go` に `ResolveFinding` メソッドを追加し、従来の `InsertDisappearance` を置き換えた。

```go
func (d *DB) ResolveFinding(ctx context.Context, instanceID, scanID uuid.UUID) error {
    tx, err := d.Pool.Begin(ctx)
    // ...
    tx.Exec(ctx, `INSERT INTO vulnerability_disappearances ...`)
    tx.Exec(ctx, `UPDATE current_finding_status SET is_active = false, updated_at = now() WHERE instance_id = $1`)
    return tx.Commit(ctx)
}
```

2 つの操作を 1 トランザクションにまとめることで、片方だけ成功する不整合状態を防ぐ。

### Diff engine: エラーハンドリングの変更

`services/oracle/internal/diff/engine.go` の resolved finding 分岐で、従来はログ出力のみで処理を継続していたが、`ResolveFinding` の失敗時には `Detect` 自体がエラーを返すように変更した。projection の不整合は UI に直接影響するため、サイレントに継続するよりも明示的に失敗させる方が安全と判断した。

### インターフェース更新

`services/oracle/internal/diff/repository.go` の `ObservationReader` インターフェースから `InsertDisappearance` を削除し、`ResolveFinding` に置き換えた。

### Phase 2: 起動時 Backfill

#### 背景

Phase 1 で `ResolveFinding` をトランザクション化したが、修正前に `vulnerability_disappearances` に記録された行は `current_finding_status.is_active = true` のまま残っていた。これらの finding は既に消えているためその後のスキャンの diff にも出現せず、新コードの `ResolveFinding` が呼ばれる機会がない。実際に 2 件の stale row が確認された。

#### DB 層: `BackfillResolvedFindings` メソッド

`services/oracle/internal/db/queries.go` に追加済み。disappearance があり、かつそれ以降に再観測されていない finding を一括で `is_active = false` に更新する。

```go
func (d *DB) BackfillResolvedFindings(ctx context.Context) (int64, error) {
    tag, err := d.Pool.Exec(ctx, `
        UPDATE current_finding_status
        SET is_active = false, updated_at = now()
        WHERE is_active = true
          AND EXISTS (
            SELECT 1 FROM vulnerability_disappearances vd
            WHERE vd.instance_id = current_finding_status.instance_id
              AND NOT EXISTS (
                SELECT 1 FROM vulnerability_observations vo
                WHERE vo.instance_id = current_finding_status.instance_id
                  AND vo.observed_at > vd.disappeared_at
              )
          )
    `)
    // ...
}
```

このクエリは冪等であり、何度実行しても安全。

#### 起動時配線: `runStartupBackfill` ヘルパー

`services/oracle/main.go` に `resolvedFindingBackfiller` インターフェースと `runStartupBackfill` ヘルパー関数を追加。`main()` では DB 接続成功直後、Redis 接続やスケジューラ起動より前に 1 回だけ呼び出す。

```go
type resolvedFindingBackfiller interface {
    BackfillResolvedFindings(ctx context.Context) (int64, error)
}

func runStartupBackfill(ctx context.Context, database resolvedFindingBackfiller) {
    if count, err := database.BackfillResolvedFindings(ctx); err != nil {
        slog.Warn("backfill resolved findings failed", "error", err)
    } else if count > 0 {
        slog.Info("backfilled resolved findings", "count", count)
    }
}
```

設計判断:

- **失敗時は warn ログを出して起動を継続する**: backfill は補正処理であり、失敗しても Oracle のコア機能（スケジューリング・差分検出・通知）は正常に動作する。起動を止めると可用性に影響するため、warn で通知しつつ起動を続行する
- **count == 0 のときはログを出さない**: 冪等な処理が毎回起動時に走るため、通常運用では 0 件が返る。不要なログノイズを避ける
- **インターフェースで抽象化**: `main()` に直接ロジックを書くのではなくヘルパーに切り出し、mock を使った unit test を可能にした

#### テスト

`services/oracle/main_test.go` に以下の 3 テストを追加:

- `TestRunStartupBackfill_SwallowsError`: エラー時に panic せず warn ログを出力すること
- `TestRunStartupBackfill_LogsOnlyWhenRowsUpdated`: `count == 0` では info ログなし、`count > 0` では `"backfilled resolved findings"` と count を含むログを出力すること
- `TestRunStartupBackfill_CallsBackfillOnce`: `BackfillResolvedFindings` が正確に 1 回呼ばれること

テストでは `slog` のデフォルトロガーを `bytes.Buffer` に向けた JSON handler に差し替え、ログ出力の内容を検証している。

### Scanner 側の挙動

decree-scanner の `upsert_current_finding_status` は観測された finding を常に `is_active = true` で UPSERT する。これは「再び観測された finding を active に戻す」正当な挙動であり、変更していない。scanner と oracle の協調により、active/inactive の状態遷移が正しく管理される。

## 代替案

### 代替案 1: DB トリガーで自動同期

`vulnerability_disappearances` への INSERT をトリガーにして `current_finding_status` を自動更新する方法。アプリケーション側の変更が不要になるメリットがあるが、トリガーはデバッグが困難でテストしにくく、Atlas migration との相性も悪い。DECREE ではビジネスロジックをアプリケーション層に置く方針を採っているため不採用。

### 代替案 2: 定期バッチで projection を再構築

`vulnerability_observations` と `vulnerability_disappearances` から `current_finding_status` を定期的に全件再構築する方法。eventual consistency は許容できるが、再構築完了までの間 UI に古いデータが表示され続ける。リアルタイム性が重要な脆弱性モニタリングツールとしては不適切と判断した。

### 代替案 3: InsertDisappearance と UpdateStatus を別メソッドで逐次実行

トランザクションを使わず 2 つの独立した DB 操作を順番に呼ぶ方法。実装は単純だが、1 つ目が成功して 2 つ目が失敗した場合に fact table と projection table の間で不整合が発生する。イミュータブルデータモデルの整合性を保証するため不採用。

### 代替案 4 (Phase 2): 手動 SQL で stale data を修正

運用者が 1 回だけ手動で UPDATE クエリを実行する方法。最も単純だが、デプロイ手順に手動ステップが加わり、実行漏れのリスクがある。また、今後同様の不整合が発生した場合にも対応できない。起動時に自動実行する方が運用負荷が低く、冪等であるため安全性も高い。

### 代替案 5 (Phase 2): backfill 失敗時に起動を停止する

backfill を必須の起動条件とし、失敗時には Oracle を停止する方法。データ整合性を最優先にできるが、backfill は補正処理であり Phase 1 の `ResolveFinding` が正常に動作していれば新規の不整合は発生しない。一時的な DB 障害で Oracle 全体が起動できなくなるのは可用性の観点で過剰なため不採用。

## 影響・トレードオフ

### メリット

- 対応済み脆弱性が UI から正しくフィルタされるようになる
- fact table (`vulnerability_disappearances`) と projection table (`current_finding_status`) の整合性がトランザクションで保証される（Phase 1）
- `ResolveFinding` 失敗時に `Detect` がエラーを返すため、不整合が silent に発生しない（Phase 1）
- 修正前のデータ不整合が Oracle 起動時に自動修復される（Phase 2）
- backfill は冪等であり、繰り返し実行しても安全（Phase 2）

### デメリット・リスク

- `ResolveFinding` のエラーで diff 検出全体が失敗するため、一時的な DB 障害でスキャン結果の差分通知が遅延する可能性がある。ただし Oracle のリトライ機構によって次回ポーリング時に再処理される（Phase 1）
- `InsertDisappearance` を直接呼んでいた箇所があれば影響を受ける。現状は diff engine のみが呼び出し元であることを確認済み（Phase 1）
- backfill クエリは毎回起動時に実行されるが、stale data が解消された後は 0 件で即座に返るため起動時間への影響は軽微（Phase 2）

### パフォーマンスへの影響

Phase 1: トランザクション化により DB ラウンドトリップが 1 回増えるが、disappearance の発生頻度は低く（脆弱性が解消されたときのみ）、実用上の影響は無視できる。

Phase 2: backfill クエリはサブクエリで `vulnerability_disappearances` と `vulnerability_observations` を結合するが、`instance_id` にインデックスがあるため効率的に実行される。起動時 1 回のみの実行であり、定常的なオーバーヘッドにはならない。

## 今後の課題

- DB 層 (`queries.go`) に対する integration test 基盤がない。`ResolveFinding` のトランザクション挙動や `BackfillResolvedFindings` の SQL を DB レベルで検証するテストは follow-up として追加する
- ~~既存データで `vulnerability_disappearances` に記録があるが `current_finding_status.is_active = true` のまま残っている不整合レコードに対するバックフィル処理の検討~~ → Phase 2 で対応済み

## 関連するADR

- ADR-0031: Scanner での OSV affected range verification — スキャンパイプラインの false positive フィルタリング
- ADR-0032: Detection evidence — 検出根拠の記録
