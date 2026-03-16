# ADR-0015: カメラ自由操作ツールバーとキーボードショートカットの導入

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREE Eye の 3D ビジュアライゼーションにおけるカメラ操作は、Three.js の OrbitControls によるマウス操作（ドラッグ回転・ホイールズーム・右ドラッグパン）のみに依存していた。`resetView()`、`focusCluster()`、`focusNode()` といったカメラ制御メソッドはコード上存在していたが、UI には露出しておらず、エンドユーザーが直感的にビューを切り替える手段がなかった。

プロフェッショナルな 3D ビューアツール（Speckle、CAD ビューア等）では、コンパクトな縦型ツールバーによるカメラ操作ボタンとキーボードショートカットの提供がベストプラクティスとされている。DECREE Eye でも同等の操作性を提供する必要があった。

また、`SceneRenderer` インターフェースにはズームやビュープリセットの概念がなく、3D（ThreeSceneRenderer）と 2D（Canvas2DRenderer）の両レンダラーでこれらを統一的に扱う仕組みが不足していた。

## 決定事項

`SceneRenderer` インターフェースに `zoomIn()`、`zoomOut()`、`setViewPreset('top' | 'front')` を追加し、右上に配置するコンパクトな縦型カメラツールバー `CameraToolbar.svelte` と、キーボードショートカット（`=`/`-`/`0`/`t`/`f`）を導入する。

## 実装の概要

### インターフェース拡張（`types.ts`）

`SceneRenderer` に以下の 3 メソッドを追加:

```ts
zoomIn(): void;
zoomOut(): void;
setViewPreset(preset: 'top' | 'front'): void;
```

`setViewPreset` は string union 型を採用し、将来的な `'left'`、`'right'` 等への拡張に対応可能。

### カメラプリセット（`camera-presets.ts`）

既存の `overviewPreset`、`clusterPreset`、`nodePreset` と同列に 2 関数を追加:

- **`topDownPreset(cx, cy, span)`** — Y 軸上から見下ろすビュー。OrbitControls の gimbal lock を回避するため、`lookAt` の Z 座標に 0.001 の微小オフセットを付与
- **`frontPreset(cx, cy, span)`** — Z 軸方向からの正面ビュー

どちらも `dist = max(span * 1.2, 20)` で適切な視距離を確保する。

### 3D レンダラー（`ThreeSceneRenderer.ts`）

- **`zoomIn()`** — カメラを `OrbitControls.target` 方向に 20% 接近させ、`animateCamera()` でスムーズ遷移。`minDistance` でクランプ
- **`zoomOut()`** — 同ロジックで 20% 後退。`maxDistance` でクランプ
- **`setViewPreset()`** — シーンバウンディングボックスを計算し、対応するプリセットに渡して `animateCamera()` で遷移
- **`getSceneBounds()`** — `resetView()` と `setViewPreset()` で重複していたバウンディングボックス計算を private メソッドに抽出し DRY 化

### 2D フォールバック（`Canvas2DRenderer.ts`）

- **`zoomIn()`** — `scale *= 1.25`、キャンバス中心基準でオフセットを調整
- **`zoomOut()`** — `scale *= 0.8`、同様のオフセット調整
- **`setViewPreset()`** — 2D には視点角度の概念がないため `fitView()` にフォールバック

### ツールバー UI（`CameraToolbar.svelte`）

HUD デザイン言語に準拠したコンパクトな縦型ツールバー。lucide-svelte のアイコンを使用（追加依存なし）:

| ボタン | アイコン | ショートカット | 備考 |
|--------|----------|----------------|------|
| Zoom In | `ZoomIn` | `=` / `+` | |
| Zoom Out | `ZoomOut` | `-` | |
| Fit All | `Maximize` | `0` | |
| Top View | `ArrowDown` | `T` | 3D のみ表示 |
| Front View | `ArrowRight` | `F` | 3D のみ表示 |

`is3D` プロップで 3D 専用ボタン（Top View / Front View）の表示を制御。`hud-panel` クラスにより既存のコーナーブラケット装飾が自動適用される。

### 統合（`VisualizationCanvas.svelte`）

- ツールバーを `absolute right-3 top-3 z-10` に配置（左上の TopRisksSummary と干渉しない）
- `<svelte:window onkeydown={handleKeydown} />` でキーボードショートカットを実装
- テキスト入力要素（`<input>`、`<textarea>`、`<select>`）にフォーカスがある場合はショートカットをスキップ

### テスト環境の改善（`vite.config.ts`）

Svelte 5 コンポーネントの `@testing-library/svelte` テストが jsdom 環境で SSR モジュールを読み込む問題を修正。`resolve.conditions: ['browser']` を追加し、クライアントサイドモジュールが使用されるようにした。

### テスト

TDD ワークフローに従い、全ステップでテストファースト:

- `camera-presets.test.ts`（新規） — `topDownPreset`、`frontPreset` の位置計算・距離クランプ・gimbal lock 回避: 5 テスト
- `ThreeSceneRenderer.test.ts` — `zoomIn`、`zoomOut`、`setViewPreset` のモック検証: 4 テスト追加
- `Canvas2DRenderer.test.ts` — スケール変更・エラーなし確認: 3 テスト追加
- `CameraToolbar.test.ts`（新規） — ボタン表示・3D トグル・クリックコールバック: 8 テスト

全 93 テスト通過、型チェック・lint エラーなし。

## 代替案

### 1. ブラウザネイティブのホイールズームのみで対応

OrbitControls のホイールズームは既に機能しているため、UI ボタンを追加しない選択肢も検討した。しかし、タッチパッド環境やアクセシビリティの観点から、明示的なボタン操作は必要と判断した。

### 2. フローティングメニュー / コンテキストメニュー方式

右クリックコンテキストメニューでカメラ操作を提供する方式も検討したが、OrbitControls が右ドラッグをパン操作に使用しているため競合する。また、常時表示のツールバーの方がディスカバラビリティが高い。

### 3. Svelte Store ベースのカメラ状態管理

カメラ状態を Svelte Store で管理し、リアクティブに同期する方式も検討したが、Three.js の `animateCamera()` によるフレーム単位の補間と競合するリスクがあった。現行の命令型 API（メソッド呼び出し）の方がアニメーション制御との相性が良い。

## 影響・トレードオフ

### メリット

- マウス操作に不慣れなユーザーでもカメラ操作が可能になる
- キーボードショートカットにより、パワーユーザーの操作効率が向上
- 定点ビュー（トップダウン・フロント）により、脆弱性クラスタの全体俯瞰が容易になる
- `SceneRenderer` インターフェースの統一により、将来のレンダラー追加時にも一貫した操作性を提供できる

### デメリット・リスク

- ツールバーが右上に常時表示されるため、小画面環境では可視化領域をやや圧迫する
- キーボードショートカット `f` がブラウザのページ内検索ショートカット（`Ctrl+F`）と混同される可能性がある（修飾キーなし単体のため実際には競合しない）
- gimbal lock 回避の微小オフセット（0.001）は数値的には安全だが、極端なズームレベルでは視覚的に無視できない場合がありうる

### パフォーマンスへの影響

- `animateCamera()` によるスムーズ遷移は既存の `requestAnimationFrame` ループ内で処理されるため、追加のレンダリングコストはない
- `getSceneBounds()` はノード数に比例する O(n) 計算だが、ズーム操作は低頻度（ユーザー操作起因）のため実用上問題ない
- 2D レンダラーのズームは `scale` と `offset` の更新 + `draw()` 呼び出しのみで、オーバーヘッドは無視できる

## 今後の課題

- `'left'`、`'right'`、`'back'` 等の追加ビュープリセットの需要に応じた拡張
- ツールバーのカスタマイズ（表示/非表示の設定、位置の変更）
- タッチデバイス向けのジェスチャー操作対応
- アニメーション中のショートカット連打時のキューイング処理

## 関連するADR

- ADR-0013: Eye 3Dレイアウトシフト・カメラフレーミング修正 — `resetView()` のバウンディングボックス計算ロジックの基盤
- ADR-0011: CVSSベクタパース・カメラ修正 — `animateCamera()` とプリセットの初期実装
