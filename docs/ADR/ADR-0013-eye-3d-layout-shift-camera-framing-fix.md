# ADR-0013: Eye 3Dビューのレイアウトずれ修正とカメラフレーミング改善

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREE Eye の Three.js 3Dビューにおいて、2つのUX上の問題が報告された。

### 問題1: ファーストビューでノードが上部に偏る

`resetView()` のカメラ位置が `(cx, cy + spread*0.8, spread*1.5)` と設定されており、カメラがノード群の中心から大幅に上方（Y方向）に配置されていた。この結果、急角度で見下ろす構図となり、Y=0 のグリッド床がビューポート下半分を占拠し、脆弱性ノードが画面上部に押しやられて見切れていた。また、Z距離の算出がアスペクト比を考慮しておらず、ウィンドウの縦横比によってフレーミングが大きく崩れていた。

### 問題2: ホバー時に描画領域が拡張される

Three.js の `WebGLRenderer` が生成する `<canvas>` 要素はデフォルトで `display: inline` となる。インライン要素はテキストベースラインの仕様上、ディセンダー分の余白（3〜4px）が下部に追加される。ノードへのホバー操作でツールチップのDOM変更が発生すると、レイアウト再計算が走りこの余白が顕在化 → `ResizeObserver` が発火 → `resize()` でアスペクト比が変更 → カメラがズレる、というカスケード障害が発生していた。

Canvas2DRenderer では既に `canvas.style.display = 'block'` を設定済みであったが、Three.js 側には同等の対策がなかった。

## 決定事項

Canvas の `display: block` 設定と FOV/アスペクト比ベースのカメラ距離計算を導入し、ファーストビューのフレーミングとホバー時のレイアウト安定性を修正する。

## 実装の概要

影響サービスは decree-eye のみ。データモデル・スキャンパイプライン・リアルタイムモニタリングへの影響はない。

### 変更ファイルと内容

| ファイル | 変更内容 |
|---------|---------|
| `ThreeSceneRenderer.ts` | `mount()` で canvas に `display: block` を設定 |
| `ThreeSceneRenderer.ts` | `resetView()` を FOV/アスペクト比ベースの距離計算に書き換え |
| `camera-presets.ts` | `overviewPreset` のカメラ高度を調整（Y:15→12, lookAt Y:3→10） |
| `VisualizationCanvas.svelte` | コンテナに `overflow-hidden` を追加 |
| `ThreeSceneRenderer.test.ts` | canvas `display: block` 設定の検証テストを追加 |

### `resetView()` のカメラ距離計算

従来の `spread * 1.5` という経験的な係数ではなく、PerspectiveCamera の FOV とアスペクト比から必要な Z 距離を幾何学的に算出する方式に変更した:

```typescript
const vFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
const aspect = this.camera.aspect;
const distY = (spanY * margin) / (2 * Math.tan(vFov));
const distX = (spanX * margin) / (2 * Math.tan(vFov) * aspect);
const dist = Math.max(distY, distX, 15);
```

Y方向の仰角は `spanY * 0.1` に抑え、ノード群をビューポート中央に配置する。

### `overviewPreset` の調整

グラフ未ロード時のフォールバックカメラも同様に、急角度の見下ろしを緩和した。`position.y: 15 → 12`、`lookAt.y: 3 → 10` とすることで、水平に近い視線でノード群を捉える。

### ホバー時レイアウトずれの防止

2層の防御を実装:
1. **`display: block`** — canvas のインラインベースライン余白を排除（根本原因の修正）
2. **`overflow-hidden`** — コンテナレベルでサブピクセルのオーバーフローをクリップ（防御的措置）

## 代替案

### カメラ距離の固定値化

ノード数やスプレッドに関係なく固定のカメラ距離を使う案。実装は簡単だが、ノード数が少ない場合に遠すぎ、多い場合に近すぎるため却下。FOV ベースの計算はノード分布に適応的にフレーミングでき、あらゆるデータセットで安定する。

### `ResizeObserver` のデバウンス

ホバー時のレイアウトずれに対して、`ResizeObserver` のコールバックをデバウンスする案。これは症状の抑制であり、canvas がインライン要素であるという根本原因を解消しない。`display: block` の1行で根本解決できるため、デバウンスは不採用とした。

### CSS `position: absolute` によるレイアウト分離

canvas を `position: absolute` にしてレイアウトフローから外す案。レイアウトずれは防げるが、コンテナのサイズ変更にリサイズが追従しなくなるリスクがあり、`display: block` と比較してオーバーキルであるため不採用。

## 影響・トレードオフ

### メリット

- ファーストビューでノード群がビューポート中央に正しくフレーミングされる
- ウィンドウの縦横比が変わってもカメラ距離が適切に調整される
- ホバー操作でカメラがズレるカスケード障害が解消される
- Canvas2DRenderer と Three.js レンダラーで `display: block` の設定が統一される

### デメリット・リスク

- `overviewPreset` のカメラ位置変更により、グラフ未ロード時の初期ビューの見た目が変わる。ただし改善方向の変更であり、ユーザー体験への悪影響はない
- `resetView()` の計算が若干複雑になるが、三角関数1回の追加で可読性への影響は軽微

### パフォーマンスへの影響

- `resetView()` での `Math.tan()` 呼び出しが追加されるが、カメラリセット時の1回のみであり、レンダリングループには影響しない
- `display: block` により不要な `ResizeObserver` の発火が抑制され、ホバー時の無駄なリサイズ→再描画チェーンが削減される（微小だが改善方向）

## 今後の課題

- グリッド床の表示範囲やカメラの `far` プレーンの最適化（現在 `far: 1000` は過大な可能性）
- ノード数が極端に多い場合（1000+）のフレーミング検証
- `clusterPreset` / `nodePreset` も同様の FOV ベース計算に移行するか検討

## 関連するADR

- ADR-0008: Eye WebGLコンテキストリーク修正 — 同じ `ThreeSceneRenderer` のリソース管理に関する修正
- ADR-0011: CVSSベクタパース・カメラ修正 — カメラプリセットに関する先行修正
- ADR-0012: OSVバッチハイドレーション・リースクリーンアップ・ホバー修正 — ホバー関連の先行修正
