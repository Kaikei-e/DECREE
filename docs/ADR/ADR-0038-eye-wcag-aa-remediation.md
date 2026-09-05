# ADR-0038: Eye の WCAG 2.2 AA 是正と severity の非カラー符号化

## ステータス

Accepted

## 日付

2026-09-05

## コンテキスト

ADR-0006 で導入した HUD/CIC デザインシステムは視覚的アイデンティティを確立したが、
アクセシビリティの観点で計測したことがなかった。監査したところ、
**型チェック自体が一度も走っていなかった**ことが判明した。

`package.json` の `"check": "svelte-check --tsconfig ./tsconfig.json"` は
`tsconfig.json` が `./.svelte-kit/tsconfig.json` を extends しているため、
`svelte-kit sync` を先に走らせないと必ず失敗する。クリーンチェックアウトでも CI でも
起動できていなかった。Biome は `.svelte` の script ブロックしか見ないため、
**Svelte コンパイラの a11y 警告も実質的に無効化されていた**。

`src/` 全体で `aria-*` と `role=` の出現回数は 0〜1 だった。

### 計測したコントラスト

sRGB 相対輝度で算出（背景は実使用箇所の合成後の値も含めて計測した）。

| トークン | 値 | hud-surface 上 | 判定 |
|---|---|---|---|
| `--color-hud-text-muted` | `#3d5a73` | **2.43:1** | 本文 4.5:1 も非テキスト 3:1 も不合格 |
| `--color-hud-accent-dim` | `#006680` | **2.68:1** | テキスト・状態ボーダー・フォーカスリングの三役で不合格 |
| `--color-hud-border` | `#1a2a3a` | **1.20:1** | フォームコントロールの境界として不合格 |

`--color-hud-text-muted` は装飾ではなく**本文を担っていた**（DetailPanel の帰属情報、
ScoreBreakdown のスコア内訳ラベル、TimelineSlider のタイムスタンプなど 34 箇所）。

フォーカスリングは `outline: 1px solid var(--color-hud-accent-dim)` で、
実際に乗るパネル背景に対して 2.86:1。SC 1.4.11 の 3:1 に届かず、太さも不足していた。
さらに `input[type="range"] { outline: none }` の詳細度 (0,1,1) が
`*:focus-visible` (0,1,0) を上回っており、**range 入力にはフォーカス表示が存在しなかった**。

### 色覚特性のシミュレーション

Machado et al. 2009 の変換行列と CIEDE2000 で 5 段階の severity 色を評価した。

| 組 | protanopia | deuteranopia | tritanopia |
|---|---|---|---|
| CRITICAL vs HIGH | 27.07 | **13.27** | **15.33** |
| HIGH vs MEDIUM | **14.78** | **10.00** | **18.05** |
| MEDIUM vs INFO | **8.06** | **14.47** | 46.39 |

deuteranopia では赤・橙・黄・緑が黄軸に潰れ、明度順が
CRITICAL 60.4 < HIGH 73.8 < INFO 78.3 < MEDIUM 88.2 と**深刻度と逆転**する。
最も危険な CRITICAL が最も目立たなくなる。

色相を動かして分離を試みたが、deuteranopia で HIGH vs MEDIUM が ΔE00 = 8.57 と
かえって悪化した。**赤緑色覚特性下で 5 段階を色のみで分離するのは、
赤=危険 / 緑=安全という信号色の意味を捨てない限り原理的に不可能**である。

## 決定事項

1. 型チェックを実際に実行できるようにする
2. 本文を担っている色トークンを WCAG 2.2 AA に適合させる。ただし**最小変更**とし、
   HUD のアイデンティティ（シアン×ダーク）は維持する
3. severity に**ノッチ数**という非カラーチャンネルを追加する（SC 1.4.1）
4. スコア未評価を「最も安全」として描かない

## 実装の概要

### ツールチェーン

```
"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
"prepare": "svelte-kit sync"
```

これにより Svelte コンパイラの a11y 警告が初めて CI に乗る。

### 色トークン

| トークン | before | after | 効果 |
|---|---|---|---|
| `--color-hud-text-muted` | `#3d5a73` | `#66879f` | 2.43 → 4.63（本文 AA） |
| `--color-hud-accent-dim` | `#006680` | `#0093b8` | 2.68 → 4.90（Δ色相 +1.2°） |
| `--color-hud-border-control` | — | `#4a7397`（新規） | 3.50（SC 1.4.11） |

`--color-hud-border` は装飾ハーフライン専用として据え置き、
フォームコントロールの境界は新設した `--color-hud-border-control` を使う。
`--color-hud-accent` / `--color-hud-text` / severity 5 色は変更していない。
severity 色は変えても色覚特性の衝突が解決しないことを計測で確認したため、
非カラー符号化で対処する。

### フォーカスリング

```css
*:focus-visible {
	outline: 2px solid var(--color-hud-accent);
	outline-offset: 2px;
	box-shadow:
		0 0 0 6px var(--color-hud-void),
		0 0 12px 2px rgb(0 229 255 / 0.45);
}
```

シアンの細線の内外を void の暗リングで挟むことで、背後が 3D シーンの明るいカラムでも
隣接コントラストが 12.93:1 に固定される。`input[type="range"] { outline: none }` は削除し、
thumb には個別のリングを与えた。`@media (forced-colors: active)` では
`box-shadow` が UA に落とされるため `Highlight` の outline に切り替える。

### severity のノッチ符号化

`SEVERITY_NOTCHES`（CRITICAL 4 → LOW 1、UNKNOWN 0）を単一の真実として `model.ts` に置き、
3 箇所すべてで同じ語彙を使う。

- **DOM**: `SeverityBadge` の 4 スロット縦レール。色・形・テキストの三重冗長
- **3D**: カラム上部に巻きつく暗い帯。`hud-void` は全 severity 色に対して 5.17〜14.08:1 で
  SC 1.4.11 を満たす。単一の追加 `InstancedMesh` で描き、CRITICAL のキャップも
  同じメッシュに相乗りさせたので **draw call の増加は +1**
- **2D**: ノード円の周囲の放射状ティック

帯を選んだのは、トップキャップ形状だと真横から見たときに消えるため。

### UNKNOWN

`Severity` から `INFO`（`#00E676` の緑）を削除し `UNKNOWN`（`#9AA0A6`）を追加した。
scanner の `severity_label()` は `critical / high / medium / low / unknown` しか返さないため
`INFO` はバックエンドが一度も生成しない値であり、スコア未評価の 113 件 (11%) が
そこに落ちて緑・ノッチ 0・最低のカラム高で描かれていた。
UNKNOWN は空のノッチレール（「レベル 0」に見える）ではなく中空の菱形マーカーで表す。

### その他

- `prefers-reduced-motion: reduce` で `.hud-live-pulse` と 800ms のカメラアニメーションを停止
- `.hud-scanlines` は静的な 4px 周期・alpha 0.015 のままとする。
  動かすと局所フリッカを生み SC 2.3.1 に抵触する
- アイコンのみのボタンに `aria-label`、トグルに `aria-pressed`、
  range 入力に `aria-valuetext`、キャンバスに `role="application"` と
  キーボード操作、SSE 更新に live region を追加
- `ScoreBreakdown` のバーが各項の実上限で正規化されておらず、
  EPSS > 0.286 でトラックを最大 350% 突き破っていたのを修正（ADR-0035 と併せて）

## 代替案

### 1. ランプ全体を再設計する（text-muted `#7b98ae` + text-secondary `#96b6cd`）

階層差 L* 11 を確保できて読みやすさは上がるが、全体が明るくなり
HUD の沈んだ質感が薄まる。「維持したまま洗練」という方針に反するため不採用。
代わりに 3D キャンバス上に浮くパネルの不透明度を `/76`〜`/58` から `/92` に上げ、
明るいカラムの上でもコントラストが保たれるようにした。

### 2. severity 色を色覚特性向けに調整する

計測の結果、色相を動かしても deuteranopia での分離は改善せず、
HIGH vs MEDIUM はむしろ悪化した (ΔE00 10.00 → 8.57)。不採用。

### 3. APCA でコントラストを検証する

APCA は normative ではなく WCAG 3 の作業草案からも 2023 年に削除されている。
準拠の根拠にならないため WCAG 2.2 で判定した。

## 影響・トレードオフ

### メリット

- 本文とフォーカス表示が AA に適合する
- 色覚特性下でも severity が読める
- 型チェックと a11y 警告が CI で機能するようになる

### デメリット・リスク

- ノッチは小さいので、極端に離れた視距離では読めない。色との併用が前提
- `--color-hud-border` と `--color-hud-border-control` の使い分けを間違えると
  SC 1.4.11 の是正が無効になる。装飾線とコントロール境界の区別を保つこと
- Tailwind v4 の `@theme` は未参照トークンを tree-shake するため、
  `--color-hud-border-control` はユーティリティクラス経由でしか機能しない。
  Svelte の `<style>` ブロックに生の `var(...)` を書いても解決されない

## 今後の課題

- 実機の支援技術（NVDA / JAWS / VoiceOver）での検証。今回は自動チェックと
  ロール／名前の単体テストまで
- SC 2.5.8 Target Size: range スライダーの thumb が 12×12px で不足
- キャンバスの `role="application"` は暫定。本来は `aria-activedescendant` で
  焦点ノードを指すべきだが全ノード分の DOM を要する。
  Table ビューがノードの正式なアクセシブル等価物になったので見直す余地がある

## 関連するADR

- ADR-0006: Eye HUD/CIC デザインシステム
- ADR-0035: DECREE Score のスケール正規化
- ADR-0037: 空間ビューの advisory 集約
