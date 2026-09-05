# ADR-0039: gateway の keyset ページネーション修正とクエリ面の拡張

## ステータス

Accepted

## 日付

2026-09-05

## コンテキスト

Eye にソート可能・検索可能な一覧を追加するにあたり `GET /api/projects/{id}/findings` を
調べたところ、既存の keyset ページネーションに欠陥が見つかった。

```sql
ORDER BY COALESCE(cfs.last_score, 0) DESC, vi.id          -- id は昇順
WHERE ... AND (COALESCE(cfs.last_score, 0), vi.id) < ($n, $n+1)
```

行比較 `<` は `score < s OR (score = s AND id < i)` に展開される。これは
`id DESC` に対応するタイブレークであり、ORDER BY の `id ASC` と方向が逆である。
そのため同スコアのグループでは既出行を再選択し、先に進まない。
`COALESCE(cfs.last_score, 0)` が NULL スコアをすべて 0 に潰すため、
同値グループは実データでも大きくなる。

### 実測（1200 件のシードデータ、limit=200 で最後まで追跡）

```
7 ページ / 返却 1323 行 / distinct 1193 行
→ 130 行が重複返却、7 行は一度も返らなかった
返らなかった 7 行: score 0.0 が 5 件、3.663 が 2 件
```

同じ欠陥が `ListTimeline` にも存在した。`ORDER BY occurred_at DESC, id`（昇順）に対し
述語が `(vo.observed_at, vo.id) < (...)`。シードには `observed_at` が重複する
タイムスタンプが 156 組あり、全 7482 件を追跡すると 7483 件返り 1 件が重複した。

加えて、Eye 側は `limit` も `cursor` も送らず `has_more` / `next_cursor` を読んでいなかった。
gateway の既定 limit は 50 なので、**3D シーンにも Priority Queue にも
常に上位 50 件しか出ていなかった**。

## 決定事項

1. keyset のタイブレーク方向をソート方向に一致させる
2. `findings` にソート・検索・advisory 絞り込みを追加する
3. advisory 集約エンドポイントを追加する
4. 単一プロジェクトと facets のエンドポイントを追加する

## 実装の概要

### keyset の修正

タイブレークの向きをソート方向に揃え、述語が「既出行」の厳密な否定になるようにした。

```sql
-- desc
WHERE ... AND (<sortExpr>, vi.id) < ($n::<type>, $n+1::uuid)
ORDER BY <sortExpr> DESC, vi.id DESC
-- asc
WHERE ... AND (<sortExpr>, vi.id) > ($n::<type>, $n+1::uuid)
ORDER BY <sortExpr> ASC,  vi.id ASC
```

`<sortExpr>` は必ず非 NULL になるよう構成し（`COALESCE(...,0)`、severity は
`CASE lower(cfs.last_severity)` で 0..4、`COALESCE(last_observed_at, '0001-01-01')`）、
ORDER BY と cursor 述語を同一の式から生成する。

timeline は `ORDER BY occurred_at DESC, id` を `, id DESC` に変更（1 行）。

### 検証

8 ソートキー × 2 方向 = 16 通りについて、小さな limit で最後まで捲り
「未ページ結果と完全一致・重複ゼロ・欠落ゼロ」を検証する統合テストを追加した。
実データ 1200 件を limit=37 で全ページ走査し、16 通りすべてで
rows=1200 / unique=1200 を確認。advisory 側も 14 サブテスト全通過、
`sum(instance_count) = 1200` が findings 全件と一致することを確認した。

テストが実際に効くことも確認している（タイブレークを固定方向に改変すると即座に
"returned 2 times" / "never returned" で落ちる）。

### クエリ面の拡張

| パラメータ | 値 | 既定 |
|---|---|---|
| `sort` | `decree_score` / `severity` / `epss` / `cvss` / `package` / `advisory` / `target` / `last_observed` | `decree_score` |
| `order` | `asc` / `desc`（小文字のみ） | キーごとの既定 |
| `q` | trim 後 1〜128 文字。package 名 / advisory ID / target 名に ILIKE | なし |
| `advisory` | 完全一致 | なし |

`q` は LIKE メタ文字を Go 側でエスケープし、必ずバインド変数に渡す（`ESCAPE E'\\'`）。
128 文字超は 400。

cursor は base64url の `v1|<sort>|<dir>|<value>|<id>` に変更し、
ソートキーと方向を埋め込んで不一致を `cursor_sort_mismatch` (400) で拒否する。
**フロントは `q` や `severity` の変更時にも cursor をクリアする必要がある**
（これらは mismatch にならないため）。

### 新規エンドポイント

- `GET /api/projects/{id}` — `<h1>` にプロジェクト名を出すため
- `GET /api/projects/{id}/facets` — ecosystems と severity 別件数を、
  **呼び出し側のフィルタと独立に**返す。Eye の ecosystem フィルタは
  絞り込み済みの結果から選択肢を作っていたため、npm を選ぶと候補が `["npm"]` だけに縮退し、
  Reset 以外で他へ移れなくなっていた
- `GET /api/projects/{id}/advisories` — advisory 単位の集約（ADR-0037）

### severity=unknown の不整合

facets は `last_severity IS NULL`（実データで 75 件）を `unknown` に集計する一方、
`severity=unknown` フィルタは完全一致なので 54 件しか返さず、
チップの数字を押しても再現しない状態だった。
`severity=unknown` のときだけ `(cfs.last_severity = $n OR cfs.last_severity IS NULL)` とし、
表示と挙動を一致させた。

## 代替案

### クライアント側で全件ロードしてソート・検索する

gateway を変更せずに済むが、5000 件規模で破綻し、
サーバが既に持っているインデックスを使えない。不採用。

### advisory のグルーピングをクライアント側で行う

keyset ページングがグループをページ境界で分断するため、件数が誤る。
集約はサーバ側で行う必要がある。不採用。

## 影響・トレードオフ

### メリット

- ページネーションが正しくなる（重複・欠落の解消）
- テーブルのソート・検索がサーバ側で成立する
- ファセットが自己閉塞しなくなる

### デメリット・リスク

- **cursor の形式に互換性がない。** 旧 cursor は 400 になる
- `min_epss` のパース失敗は既存挙動どおり黙って無視される（未変更）
- `ecosystem` フィルタは大文字小文字を区別する完全一致。
  格納値は `Go` / `PyPI` / `RubyGems` / `crates.io` などが混在するため、
  facets が返す値をそのまま送る運用が必須

### パフォーマンスへの影響

実測で `/advisories?limit=50` が 25ms、`/findings?limit=50` が 6ms（1200 件のデータ）。

`q` の ILIKE は現状 Seq Scan（1200 行で 7ms）。
**OR の 1 項が別テーブルの `t.name` を参照するため結合後の Join Filter になり、
`vulnerability_instances` 側のどんなインデックスも効かない。**
trigram インデックスを張っても同様で、効かせるには vi 側 2 項と targets 側を
分けた UNION への書き換えが必要になる。数万件規模になるまでは現状維持と判断した。

## 今後の課題

- `q` の性能。必要になった時点で `pg_trgm` + クエリの UNION 化。
  Atlas 管理のためマイグレーションは別途
- `min_score` フィルタの追加（「score ≥ 5 だけ表示」がサーバ側でできない）
- `dependency_path` が「その target のそのスキャンの全エッジ」を返しており、
  特定 finding へのパスに絞られていない
- `min_epss` のパース失敗を 400 にするかどうかの統一

## 関連するADR

- ADR-0020: gateway のリファクタリング
- ADR-0029: gateway の severity フィルタ大文字小文字正規化
- ADR-0037: 空間ビューの advisory 集約
