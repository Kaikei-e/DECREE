# ADR-0036: Eye の合成エッジを廃止し、集合所属は位置とグルーピングで表す

## ステータス

Accepted

## 日付

2026-09-05

## コンテキスト

Eye のシーンには、findings 同士を結ぶエッジが描かれていた。これは依存関係ではなく、
list endpoint から導出できる 2 つの関係を star 状に合成したものだった。

- `ecosystem + package_name` が同じ findings を、最高スコアの member にぶら下げる
- `advisory_id` が同じ findings を、同様にぶら下げる

代表的な規模（1028 active findings）を投入して確認したところ、
シーンは青い線のマットに覆われ、下のカラムが読めなくなった。

### 計測結果

| 項目 | 値 |
|---|---|
| active findings | 1028 |
| package cohort（ecosystem + package 名） | 111 |
| **複数パッケージにまたがる advisory** | **0 件** |
| package star が張る辺 | 917 = 1028 − 111 |
| advisory star が張る辺 | 378 |
| 全エッジ | 1295 |
| district 境界をまたぐエッジの割合 | 77.0% |
| エッジ長の中央値 | 22.57（シーン奥行き 12.8 の 1.8 倍） |

この数字が意味するところは 2 つある。

1. **advisory ⊂ package が厳密に成立している。** 複数パッケージにまたがる advisory が
   1 件も存在しないため、advisory cohort は必ず package cohort の部分集合になる。
   したがって advisory 由来の **378 本 (29%) はすべて同一連結成分の内部を結んでおり、
   連結性の情報をまったく持たない**。
2. **package star の 917 本は、ちょうど 1028 − 111 = spanning forest である。**
   つまり全エッジが表しているのは「1028 件を 111 個の互いに素な集合に分割した」という
   **集合所属**であって、pairwise な関係ではない。

集合所属を edge で描くのは encoding のカテゴリ違いである
（Alsallakh et al., "Visualizing Sets and Set-typed Data", EuroVis STAR 2014 — node-link は
element-set diagram において集合関係を表現できないと明記している）。
さらに Bach et al., TVCG 2017 の統制実験では、同じ関係を描線（edge bundling）で表すより
グルーピング（Power Graph）で表すほうが正確（86% vs 77%）かつ高速（9.3s vs 17.2s）だった。

## 決定事項

合成エッジの常時描画を廃止する。集合所属は位置・色・グルーピングで表し、
エッジは選択・ホバー時の探索にのみ用いる。

## 実装の概要

### 可視化への影響

- `computeAdvisoryLayout()`（ADR-0037）は `edges: []` を返す。3D / Canvas2D いずれも
  描画するエッジを持たない
- 既存の `buildEdges()`（`layout.ts`）は instance 粒度のレイアウトにのみ残る
- 関係性は DetailPanel のテキスト（「同じ advisory: N 件 / M targets」「同じパッケージ: N 件」）
  で提示する。これは advisory 集約ビューでは `instance_count` / `target_count` として
  すでに 1 行に畳まれている

### 凡例

`Glow = EPSS` は実装が伴っていなかった（EPSS はカラムの色を白へ最大 18% 混ぜるだけで、
実際の glow は選択インジケータ）。凡例を実装に合わせ、
`Color + notches = severity` / `Height = DECREE score` / `Width = connections` に改めた。

## 代替案

### 1. エッジを間引く・透明度を下げる・色を変える

情報を持たないものを薄くしても情報は増えない。378 本は数学的に冗長で、
残る 917 本は集合分割の再表現でしかない。減らすのではなく消すのが正しい。不採用。

### 2. Hierarchical Edge Bundling を導入する

HEB (Holten, InfoVis 2006) は階層構造を前提とするが、ここでのエッジは階層ではない。
階層不要な FDEB (Holten & van Wijk, EuroVis 2009) は O(N·M²·K) で、
原論文の実測が 1715 nodes / 9780 edges に 80 秒。
加えて Bach et al. 2017 でグルーピングに正確性・速度とも負けている。
束ねると「繋がっていないノード間に接続があるように見える」false adjacency も生じる。不採用。

### 3. 本物の依存エッジを描く

`dependency_path` は per-finding detail endpoint にしか存在せず、
list endpoint のレスポンスには含まれない。レイアウト時点では取得できない。
なお gateway の `dependency_path` は現状「その target のそのスキャンの全エッジ」を返しており、
特定 finding へのパスに絞られていない（別途対応が必要）。今回は範囲外。

## 影響・トレードオフ

### メリット

- シーンから 1295 本の線が消え、カラムが読めるようになる
- 情報の損失はゼロ（計測で確認済み）
- ライン用の draw call と頂点バッファが不要になる

### デメリット・リスク

- 「このパッケージを上げれば複数の findings が消える」という気づきが、
  線という形では得られなくなる。advisory 集約行の `instance_count` /
  `target_count` と DetailPanel のテキストがその役割を担う
- 選択時のオンデマンド描画は未実装（今後の課題）

### パフォーマンスへの影響

改善方向のみ。per-frame の割り当ては元々ゼロで、draw call が 1 本減る。

## 今後の課題

- 選択時のオンデマンド・エッジ描画（選択した advisory と同じパッケージを共有する
  advisory へのハイライト）
- gateway の `dependency_path` を「その finding へのパス」に絞ること。
  現状は target 単位の全エッジを返しており、DetailPanel が無関係なエコシステムのエッジまで
  1 本の鎖として描画している

## 関連するADR

- ADR-0026: Eye Threat Skyline のカラム／ディストリクト
- ADR-0035: DECREE Score のスケール正規化
- ADR-0037: Eye の 3D シーンを advisory 集約にする
