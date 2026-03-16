# ADR-0029: Gateway での Severity フィルタ値の小文字正規化

## ステータス

Accepted

## 日付

2026-03-17

## コンテキスト

decree-eye の FilterBar で Severity（例: "CRITICAL"）を選択すると、可視化画面に「No vulnerability data available」と表示され、フィルタリング結果が 0 件になる問題が報告された。

原因は、システム内での severity 値の大文字・小文字の不一致である:

- **decree-eye（フロントエンド）**: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` を大文字で送信
- **decree-scanner（Rust）**: `severity_label()` 関数が `critical`, `high`, `medium`, `low`, `unknown` を小文字で生成し、PostgreSQL に格納
- **decree-gateway（Go）**: クエリパラメータをそのまま SQL に渡しており、正規化なし
- **PostgreSQL**: `en_US.utf8` コレーションにより `CRITICAL ≠ critical` と判定

加えて、フロントエンドが提供する `INFO` に対応するラベルは scanner 側に存在せず、scanner が生成する `unknown` がフロントエンドの選択肢にないという副次的な不整合もあった。

## 決定事項

Gateway（BFF）のクエリパラメータ読み取り時に `strings.ToLower()` で severity 値を小文字に正規化する。併せて、フロントエンドの severity 選択肢から存在しない `INFO` を削除し、scanner が実際に生成する `UNKNOWN` に置き換える。

## 実装の概要

### decree-gateway（Go）

`services/gateway/internal/api/findings.go` にて、severity クエリパラメータの取得時に `strings.ToLower()` を適用:

```go
if v := q.Get("severity"); v != "" {
    lower := strings.ToLower(v)
    params.Severity = &lower
}
```

Gateway は外部入力（HTTP リクエスト）と内部データ（PostgreSQL）の境界に位置する BFF であり、入力値の正規化を行う正準な場所である。

### decree-eye（SvelteKit）

`services/eye/src/lib/components/FilterBar.svelte` にて、severity の選択肢を修正:

```typescript
// Before
const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

// After
const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
```

フロントエンドは引き続き大文字で表示・送信する。Gateway が正規化するため、表示上の読みやすさを維持できる。

### 影響を受けるデータモデル層

なし。データモデルの変更は不要。fact table / resource table / projection table のいずれのスキーマにも影響しない。Atlas migration の追加も不要。

## 代替案

### 1. Scanner 側で大文字に変更する

scanner の `severity_label()` を大文字出力に変更し、フロントエンドと一致させる案。既存データとの不整合が生じ、過去の `vulnerability_observations`（fact table、INSERT ONLY）に格納済みの小文字値と新規挿入の大文字値が混在する。fact table は UPDATE 不可のため、データ修正には migration が必要になる。影響範囲が大きく、却下。

### 2. PostgreSQL で ILIKE / LOWER() を使用する

SQL クエリ側で `WHERE LOWER(severity) = LOWER($1)` とする案。既存のインデックスが効かなくなる可能性があり、パフォーマンスへの影響を考慮して却下。正規化はアプリケーション層で行うのが適切。

### 3. フロントエンドで小文字に変換して送信する

FilterBar で `severity.toLowerCase()` してから API に渡す案。動作はするが、正規化の責務がクライアント側に分散し、将来別のクライアント（CLI、外部連携）が追加された場合に同じ問題が再発する。システム境界である Gateway で正規化するのが堅牢。

## 影響・トレードオフ

### メリット

- DB migration なしで修正が完了する
- Scanner のデータ生成ロジックに変更がないため、既存データとの整合性を維持
- Gateway での正規化は、将来のクライアント追加時にも対応できる
- フロントエンドの表示用大文字と DB の格納用小文字を自然に分離

### デメリット・リスク

- Gateway が暗黙的に値を変換するため、API の入力と内部処理の値が異なる（ただし、大文字小文字の正規化は一般的なプラクティスであり、リスクは低い）
- `UNKNOWN` の表示名がユーザーにとって直感的でない可能性がある（将来的に表示ラベルとAPI値を分離する余地あり）

### パフォーマンスへの影響

`strings.ToLower()` の処理コストは無視できるレベルであり、パフォーマンスへの影響はない。

## 今後の課題

- severity 値の enum 化（scanner / gateway / eye で共通の定義を持つ）を検討し、型レベルで不整合を防ぐ
- FilterBar の表示ラベルと API 送信値の分離（例: 表示は "Unknown"、送信は "UNKNOWN"）

## 関連するADR

なし
