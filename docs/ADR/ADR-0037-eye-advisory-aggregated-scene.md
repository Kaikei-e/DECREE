# ADR-0037: Eye の空間ビューを advisory 集約にし、Table と Risk Plot を追加する

## ステータス

Accepted

## 日付

2026-09-05

## コンテキスト

Eye の 3D シーンは vulnerability_instance 1 件につきカラム 1 本を描いていた。
代表規模のデータ（1028 active findings / 8 targets）を投入して計測した結果、
この粒度では読めないことが分かった。

| 計測 | 値 |
|---|---|
| データが占める画面面積 | 3.1%（高さ方向 9.2%） |
| `GridHelper(200)` が占める画面幅 | 99% |
| 既定カメラの仰角 | 3.08° |
| 高さ 10.53 のカラムが遮蔽する奥行き | 196 ユニット（district の奥行きは 12.8） |
| 中央値高さのカラム越しに後列を見るのに必要な仰角 | 77.5° |
| X 方向で重なっている district の組 | 28 組中 5 組 |

仰角 77.5° を下回ると後列が完全に隠れ、上回るとほぼ真上からになって
高さ（DECREE Score）が読めなくなる。これは 3D 棒グラフの遮蔽ジレンマそのもので、
定数調整では解けない。実際 ADR-0024 / 0025 / 0026 / 0027 と 4 回チューニングして
解決していない。

さらに Priority Queue は同一 advisory が target 違いで重複し、
上位 8 件が実質 2 CVE で埋まっていた。

### 文献上の裏付け

node-link 表現の可読性が実験的に確認されている範囲は 20〜260 nodes である。

- Ghoniem, Fekete, Castagliola, *Information Visualization* 4:2 (2005) — 20/50/100 vertices、
  36 subjects。20 vertices を超えると matrix が大半の課題で node-link を上回る
- Yoghourdjian et al., IEEE VIS 2020 — 25〜175 nodes、22 participants。
  density 2 でも 100 nodes 以上で誤答・自信なしが 50% を超える

1000 nodes での課題遂行性能を測った査読研究は見つからなかった。
つまり「1000 で壊れる」は測定された事実ではなく、100 で壊れているという測定からの外挿である。

3D 自体については CodeCity (Wettel, Lanza, Robbes, ICSE 2011, 41 participants) が
正答率 +24.26% (p=.001) を示しているが、著者自身が
「focused な特定課題では Excel と互角、やや遅い」と書いている。
DECREE の主タスク「1000 件から最も緊急なものを見つけて triage する」は後者に属する。

また、調査した主要ベンダー（GitHub Advanced Security / Snyk / Wiz / Orca /
Dependency-Track / Grype / Semgrep / Endor Labs）のうち、
**1000 件規模で node-link グラフを主ビューにしている製品は 1 つもなかった**。
グラフを持つ製品では例外なく単一 issue のドリルダウン用である。

## 決定事項

空間ビューの粒度を vulnerability_instance から advisory に変更する。
併せてユーザー向けビューを **3D Spatial / Risk Plot / Table** の 3 つとし、
Canvas2D レンダラは WebGL2 非対応時のフォールバック専用に降格する。

## 実装の概要

### advisory 集約（`src/lib/graph/advisory-layout.ts`）

gateway の `GET /api/projects/{id}/advisories` が返す `AdvisoryGroup` から
`GraphModel` を構築する。ノード 1 個 = advisory 1 件（実データで 1028 → 208）。

- ノード ID は `advisory_id`
- 高さ = `max_decree_score`（グループ内の最悪 instance。トリアージは最悪ケースで決まる）
- 色 + ノッチ = 最高 severity
- サイズ = `instance_count`（blast radius）
- district = ecosystem。**1 列ではなく 2 次元グリッド**に配置し、
  間隔を `ceil(sqrt(nodes)) × pitch` という実フットプリントから算出する
  （従来の `CLUSTER_SPACING = 8` 固定は、密な district どうしを重ねていた）
- `edges: []`（ADR-0036）

box-fit 後の画面高さ占有は 9.2% → 約 52% になる計算。

### Risk Plot（`src/lib/components/BeeswarmView.svelte`）

x = EPSS（**対数軸**）、y = DECREE Score（0〜10 固定）、色 = severity、
中空リング = 未評価。Canvas 2D で描画し、依存は追加していない。

EPSS を対数にしたのは実測分布のため（中央値 0.0202 / p90 0.489 / p99 0.974）。
線形軸では 90% が左端 5% に潰れる。
EPSS = 0 と EPSS 欠損は log 軸に乗せず、それぞれ専用レーンに分離して件数を明示する。

severity と DECREE Score の相関は r = 0.808 で、従来は最も強い 2 チャンネル
（色と高さ）を実質同じ変数に費やしていた。唯一直交する EPSS を位置に昇格させることが
この画面の情報利得の中心である。

### Table（`src/lib/components/FindingsTable.svelte`）

advisory 1 件 = 1 行。`role="grid"` + roving tabindex、`aria-sort` は常に 1 列のみ、
sticky header には同じ高さの `scroll-padding-top` を組（WCAG 2.2 SC 2.4.11 / 技法 F110）。
仮想化ライブラリは使わず `content-visibility: auto` + `contain-intrinsic-size` を用いる。
JS 仮想化と違い、ページ内検索・アクセシビリティツリー・Tab 順序が保たれる。

### severity の UNKNOWN

`Severity` から `INFO`（`#00E676` の緑）を削除し、`UNKNOWN`（`#9AA0A6` の中立グレー）を追加した。
scanner の `severity_label()` は `critical / high / medium / low / unknown` しか返さないため
`INFO` はバックエンドが一度も生成しない死んだ値であり、
スコア未評価の 113 件 (11%) がそこに落ちて**「最も安全」として緑で描かれていた**。
UNKNOWN はノッチではなく中空の菱形マーカーで表す（空のノッチレールは「レベル 0」に見えるため）。

### gateway

`GET /api/projects/{id}/advisories`（keyset ページング、7 ソートキー）と
`GET /api/projects/{id}/findings?advisory=` を追加した。
グルーピングをクライアント側で行うとページ境界でグループが割れ、件数が誤るため、
集約はサーバ側で行う必要がある。

## 代替案

### 1. 3D を捨ててすべてテーブルにする

CodeCity の実験は overview / localization 課題で有意な効果を示している。
「どの target が危ないか」には 3D が効く。「1028 件のうちどれか」には効かない。
役割分担が答えであり、全廃はやりすぎ。不採用。

### 2. 定数（CLUSTER_SPACING / Y_SCALE / JITTER_RANGE）の調整で直す

ADR-0024 / 0025 / 0026 / 0027 で 4 回試して解決していない。
問題は「instance 1 件 = node 1 個」という構造であって定数ではない。不採用。

### 3. camera 距離による semantic zoom（遠 = advisory、近 = instance）

最も良い解だが実装量が大きい。まず advisory 集約とクリック展開で
同じ情報経路を成立させ、semantic zoom は今後の課題とする。

### 4. treemap

1600×900 で 1028 leaf は平均 37×37 px となりラベルが入らない
（5000 件では 17×17 px）。208 advisory まで集約すれば 83×83 px で成立するが、
Stasko et al., IJHCS 53 (2000) の実験で treemap は sunburst より初回学習コストが高い。
今回は採用しない。

## 影響・トレードオフ

### メリット

- 空間ビューが読める粒度になる（1028 → 208、画面高さ占有 9.2% → 約 52%）
- Priority Queue と Table の重複が解消する（同一 CVE が target 違いで並ばない）
- EPSS が初めて意味のあるチャンネルで表現される
- スコア未評価が「最も安全」に見えなくなる

### デメリット・リスク

- 空間ビューと Risk Plot で粒度が異なる（advisory と instance）。
  何を数えているかを画面上で明示する必要がある
- advisory と instance で選択の意味が変わるため、URL パラメータを
  `advisory` と `finding` に分ける必要が生じた
- `fetchAllFindings` / `fetchAllAdvisories` の上限は 2000 件。
  超過時は `truncated` を返すが、UI がそれを提示しなければ黙って切り捨てたことになる

### パフォーマンスへの影響

3D のインスタンス数が 1028 → 208 に減り、ライン描画も消える。
一方で layout load が findings と advisories の両方を取得するため、
初回の HTTP リクエスト数は増える（実データで 6 + 2 ページ）。

## 今後の課題

- camera 距離に応じた semantic zoom（advisory ⇄ instance）
- 選択時のオンデマンド・エッジ描画
- gateway への `min_score` フィルタ追加（「score ≥ 5 だけ表示」がサーバ側でできない）
- 2000 件上限を超える規模での挙動
- adjacency matrix（advisory × target）ビュー。
  実データでは advisory の 94% が複数 target にまたがっており、この方向は情報を持つ

## 関連するADR

- ADR-0024 / 0025 / 0026 / 0027: Eye のシーンレイアウトとカメラの試行
- ADR-0035: DECREE Score のスケール正規化
- ADR-0036: 合成エッジの廃止
