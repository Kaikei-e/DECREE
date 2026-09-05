# ADR-0035: DECREE Score のスケール正規化（EPSS 項の ×100 → ×10）

## ステータス

Accepted

## 日付

2026-09-05

## コンテキスト

DECREE Score は CLAUDE.md で「ADR なしに変更してはならない中核不変条件」と定義されている:

```
DECREE Score = (CVSS_base × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 0.25)
```

Eye に代表的な規模の実データ（1200 findings）を投入して 3D シーンを確認したところ、
可視化が完全に破綻していた。カラムが画面外まで伸びる針の束になり、地面のディストリクト板は
下端に潰れて読めない。原因を追ったところ、可視化の不具合ではなくスコアのスケールそのものに
起因することが判明した。

### 各項の実際の値域

`services/scanner/src/enrichment/score.rs` の実装から:

| 項 | 入力の値域 | 係数 | 寄与の値域 | 合計に占める割合 |
|---|---|---|---|---|
| CVSS_base | 0–10 | × 0.4 | 0–4.0 | 9.6% |
| EPSS | 0–1 | × 100 × 0.35 | **0–35.0** | **84.3%** |
| Reachability | 1–10 | × 0.25 | 0.25–2.5 | 6.0% |
| **合計** | | | **0–41.5** | |

つまり DECREE Score は事実上 EPSS の順位付けであり、CVSS と Reachability を両方とも
最小から最大まで振っても合計 6.5 しか動かない。EPSS が 0.2 違えばその差は完全に埋もれる。
実データでの上位 8 件はすべて 39 点前後に張り付き、実質 2 つの CVE が
target 違いで重複しているだけだった。

これは「CVSS だけでは実際の危険度を測れない」という DECREE の出発点に反する。
CVSS と Reachability に重みを与えた意味がほぼ失われている。

### 実装ミスと考えられる根拠

重み 0.4 / 0.35 / 0.25 の**合計が 1.0** であることは、
「同一スケールに正規化した 3 入力の加重平均」を意図した設計であることを強く示唆する。
現状は EPSS だけが 100 倍されており、加重平均として成立していない。

さらに Eye 側の既存コードは一貫して **0–10 前提**で書かれていた:

| 箇所 | 前提 |
|---|---|
| `services/eye/src/lib/components/ScoreBreakdown.svelte` | `maxScore = 10` でバーを正規化 |
| `services/eye/src/lib/graph/layout.ts` | `Y_SCALE = 5`（値域 10 なら高さ 50 に収まる） |
| `services/eye/src/lib/renderer/three/camera-presets.ts` | 上記の高さ前提でカメラをフレーミング |

フロントエンドが独立に 0–10 を前提として実装されていた事実は、
`score.rs` の `× 100.0` のほうが実装ミスであることの傍証になる。

## 決定事項

EPSS 項の係数を `× 100` から `× 10` に変更し、DECREE Score の値域を **0–10** に正規化する。

```
DECREE Score = (CVSS_base × 0.4) + (EPSS × 10 × 0.35) + (Reachability × 0.25)
             = 最大 4.0 + 3.5 + 2.5 = 10.0
```

重み 0.4 / 0.35 / 0.25 自体は変更しない。

## 実装の概要

### 影響範囲

スコア算出の実装は `services/scanner/src/enrichment/score.rs` の `decree_score()` 一箇所のみ。
gateway・oracle・eye はいずれも算出済みの値を読むだけで、式を再実装している箇所はない。

```
SBOM生成 → OSV/NVD照合 → EPSS付与 → [DECREE Score算出 ←変更] → 分類
```

### scanner

`decree_score()` の EPSS 項を `epss.unwrap_or(0.0) * 10.0 * 0.35` に変更。
doc comment と、期待値をハードコードしている既存ユニットテストを新スケールに更新する。

### データモデル

テーブル定義の変更はない。Atlas migration は不要。

- **fact table** (`vulnerability_observations`): INSERT ONLY のため、
  過去に記録された `decree_score` は旧スケールのまま残る
- **projection table** (`current_finding_status.last_score`): 再スキャンによって新スケールで上書きされる

### 再スコア

全ターゲットを再スキャンし、新スケールの observation を積む。
`services/scanner/src/enrichment/projection.rs` の `recalculate_all` が
active な `current_finding_status` を更新するため、再スキャン後に projection は新スケールへ揃う。

ローカル検証環境のシードデータについても、同じ式で再生成する。

### 可視化への影響

- **Three.js (Primary)**: `Y_SCALE = 5` のまま、カラム高さの上限が 197 → 50 になり、
  既存のカメラフレーミングが意図どおり機能する
- **Canvas2D (Fallback)**: ノード配置の y 座標が同様に縮小される
- `ScoreBreakdown.svelte` の各バーの上限は 4.0 / 3.5 / 2.5 になる

## 代替案

### 1. 0–100 スケールに正規化する

```
(CVSS × 10 × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 10 × 0.25) = 最大 100
```

「87 点」のようにパーセントとして直感的に読める利点はある。
しかし DECREE Score は CVSS と並べて表示される場面が多く、
`CVSS 9.8 / DECREE 87` は桁が違って比較しづらい。
また変更点が 3 箇所に増え、既存の Eye 側の前提ともずれる。不採用。

### 2. 式は変えず、UI 側で 0–41.5 前提に作り直す

可視化のフレーミングとスコアバーを実値域に合わせるだけなら、
scanner にも既存データにも一切触れずに済む。
しかし EPSS が全体の 84% を占める本質的な問題は残り、
「CVSS と Reachability に重みを与える」という設計意図が回復しない。
表示を実装に合わせるのではなく、実装を設計意図に合わせるべきと判断した。不採用。

### 3. 重み配分 0.4 / 0.35 / 0.25 も併せて見直す

スケールの誤りと重みの妥当性は別の論点である。
まずスケールを正しくして各項が意図どおり効く状態を作り、
重みの妥当性は実運用のデータを見てから別途判断する。今回は範囲外とする。

## 影響・トレードオフ

### メリット

- 加重平均として成立し、CVSS・EPSS・Reachability の 3 軸が設計意図どおりに効く
- 値域が CVSS と揃うため、両者を並べて表示しても直感が働く
- Eye の既存の前提（`maxScore = 10` / `Y_SCALE = 5`）と一致し、可視化が意図どおり動く
- 変更は 1 行

### デメリット・リスク

- **fact table に旧スケールの値が残る。** `vulnerability_observations` は INSERT ONLY なので、
  再スキャン以前の observation は旧スケールのままである。
  タイムライン再生で過去に遡ると、切替時点でスコアが不連続に見える
- スコアの絶対値が変わるため、通知の閾値や外部に共有済みのスコアとの整合が崩れる
- 全ターゲットの再スキャンが必要になる

### パフォーマンスへの影響

算出は乗算 1 回のため実行時コストの変化はない。
一度だけ全ターゲットの再スキャンが発生する。

## 今後の課題

- 旧スケールの observation が混在する期間のタイムライン表示をどう扱うか。
  `score_scale_version` 列を持たせて読み出し時に換算する案があるが、
  Atlas migration を伴うため今回は見送った
- 重み配分 0.4 / 0.35 / 0.25 の妥当性の検証
- Reachability の値域が 1–10 であり 0 を取り得ない点。
  `exposure_class` が不明のとき 5.0 が返るため、「データなし」と「中程度」が区別できない

## 関連するADR

- ADR-0016: CVSS4 スコアリングと severity ラベルの不具合修正
- ADR-0028: EPSS の事前取得と advisory スナップショット
- ADR-0034: EPSS 取得間隔を 12h に変更
