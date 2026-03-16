# ADR-0025: eye SceneGuide の折り畳み化とダッシュボードレイアウト再構成

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

ADR-0024 で導入した `SceneGuide` コンポーネントは、ビジュアルエンコーディングの凡例（Visual Encoding）と重大度分布（Severity Mix）を常時表示する 2 カラムグリッド構成であった。運用上、以下の課題が浮上した:

- **可視化領域の圧迫**: SceneGuide が常時展開されているため、3D キャンバスの縦方向の表示領域が恒常的に縮小していた。特に解像度の低いディスプレイや縦幅の限られたビューポートで顕著だった
- **情報の優先度の不均一**: KPI カード（フィンディング数・ターゲット数等）は常に参照するが、Visual Encoding の凡例や Severity Mix は操作に慣れたユーザーにとっては不要なことが多い
- **レイアウトの重心**: キャンバス左に `TopRisksSummary` を配置していたが、3D シーンの左側にオーバーレイ要素（読み方ガイド・凡例チップ）が集中しており、視覚的なバランスが悪かった

これらを踏まえ、SceneGuide の情報を「常時必要な最小コンテキスト」と「必要時に展開する詳細ガイド」に分離し、ページ全体のレイアウトバランスを再調整する必要があった。

## 決定事項

SceneGuide を折り畳み（collapsible）構造に再設計し、デフォルトでは要約ストリップと常時表示の読み取りキーのみを表示する。Visual Encoding と Severity Mix はユーザーの明示的な操作で展開する。併せて、ページレイアウトを `TopRisksSummary` を右サイドカラムに移動する構成に変更し、キャンバス内のオーバーレイ要素も再配置する。

## 実装の概要

### SceneGuide.svelte の再設計

**状態管理:**

Svelte 5 の `$state` rune で `showGuide` フラグを管理。`$derived` で統計カードのデータ配列 `quickStats` を生成し、テンプレート内の繰り返しを `{#each}` に集約した。

**レイアウト構造（折り畳み時）:**

- ヘッダー行: 「Scene At A Glance」タイトル + レンダラーモードバッジ（pill 形状に変更）+ 説明テキスト
- トグルボタン: `aria-expanded` 属性付きで、「Show scene guide」/「Hide scene guide」を切り替え
- KPI カード行: Visible / Targets / Critical / Fresh の 4 カード（`quickStats` 配列から生成）
- Always-On Reading Keys: 右カラムに「Orb = instance」「Height = DECREE」「Glow = EPSS」の 3 つの常時表示キー

**レイアウト構造（展開時）:**

折り畳み時の要素に加え、`border-top` で区切られた展開領域が追加表示される:

- Visual Encoding セクション: Cluster position / Severity color / Glow intensity の 3 カード（横並び）
- Severity mix: 重大度別バーチャート（右カラム）

**設計上のポイント:**

- 2 カラムグリッドから単一 `<section>` へ変更し、DOM 構造を簡素化
- `bg-hud-base/88` → `bg-hud-base/84` へ透過度を微調整し、キャンバスとの視覚的一体感を向上
- KPI カードの説明テキストを簡潔化（例: 「N active in the current filter」→ 「N active」）

### TopRisksSummary.svelte の変更

- ルート `<div>` に `flex h-full min-h-0 flex-col` を追加し、サイドカラム配置時に親の高さを埋めるよう変更
- `<ul>` の `max-h-[24rem]` 固定高さを廃止し、`min-h-0 flex-1` で残り領域を自動的に使う構成に変更

### ページレイアウトの再構成（+page.svelte）

**グリッド構造の変更:**

```
Before: flex-col → [SceneGuide] → grid[TopRisksSummary(左) | Canvas(右)]
After:  grid[flex-col[SceneGuide → Canvas](左) | TopRisksSummary(右)]
```

- メインカラム: SceneGuide（上部）+ キャンバス（残り領域）を縦積み
- 右サイドカラム: TopRisksSummary（幅 `20rem` 固定）

**キャンバス内オーバーレイの再配置:**

- 左上「How To Read This Space」→ 「Spatial Inspection」に改称、サイズ縮小（`max-w-sm` → `max-w-xs`、パディング縮小）
- 左下に「Read Order」パネルを新設（target lanes / DECREE urgency の読み順ガイド）
- 左側に縦方向の DECREE Score スケールバー（グラデーション付き）を新設（`md:` 以上で表示）
- 右下に凡例チップを移動（左下 → 右下）、内容を「Orb = instance / Color = severity / Glow = EPSS」に更新
- 背景透過度を `bg-hud-base/85` → `bg-hud-base/72` ～ `bg-hud-base/76` に調整し、キャンバスの視認性を改善

### テスト（SceneGuide.test.ts — 新規）

`@testing-library/svelte` + Vitest で 2 ケースを作成:

1. **デフォルト折り畳み検証**: 要約（KPI 値・タイトル）が表示され、「Show scene guide」ボタンが存在し、「Visual Encoding」は非表示であること
2. **展開操作検証**: ボタンクリック後に「Visual Encoding」「Severity mix」が表示され、ボタンラベルが「Hide scene guide」に切り替わること

### データモデルへの影響

なし。フロントエンド（eye）のみの変更であり、fact / resource / projection いずれの層にも影響しない。

### 可視化への影響

Three.js WebGPURenderer / Sigma.js フォールバック双方のレンダリングロジックには変更なし。変更はレイアウト・UI コンポーネント層に限定される。キャンバスの `min-h` が `28rem` → `30rem` にわずかに拡大。

## 代替案

### A: SceneGuide をタブ切り替えにする

「Summary」「Guide」の 2 タブ構成にする案。常時表示される KPI 情報量が減る（タブ切り替え時に隠れる）ため、折り畳みの方が情報の階層化に適していると判断し不採用。

### B: TopRisksSummary を下部に残す

既存の左カラム配置を維持する案。しかしキャンバス左側にオーバーレイ（Spatial Inspection ガイド・スケールバー・Read Order）が集中するため、視覚的なバランスの改善には右配置が必要と判断した。

### C: 常時表示の Reading Keys を省略し、完全に折り畳む

SceneGuide の折り畳み時に KPI カードのみ表示する案。初見ユーザーが「高さ = DECREE Score」「明るさ = EPSS」の対応関係を常に参照できるよう、最小限の Reading Keys は常時表示すべきと判断した。

## 影響・トレードオフ

### メリット

- キャンバスの垂直表示領域が増加し、3D シーンの没入感が向上する
- 操作に慣れたユーザーは凡例を非表示にして作業効率を維持できる
- TopRisksSummary の右配置により、左側のオーバーレイとの視覚的干渉が解消される
- `quickStats` 配列による KPI カード生成で、カードの追加・変更が容易になった

### デメリット・リスク

- 初回訪問時に Visual Encoding が非表示であるため、初見ユーザーが色やサイズの意味を発見しにくい可能性がある（ただし Always-On Reading Keys で最低限の情報は常時提供）
- `showGuide` 状態がコンポーネントローカルであるため、ページ遷移で折り畳み状態がリセットされる

### パフォーマンスへの影響

折り畳み時に Visual Encoding / Severity Mix の DOM ノードが `{#if}` で除去されるため、デフォルト状態でのレンダリング負荷は ADR-0024 比で微減する。展開時は同等。

## 今後の課題

- `showGuide` の状態を `localStorage` や URL パラメータで永続化し、ユーザーの好みを記憶する
- Reading Keys の内容をレンダラーモード（3D / 2D）に応じて動的に切り替える
- DECREE Score スケールバーに実際のスコア分布を反映するヒートマップ表示
- モバイルビューポートでの TopRisksSummary の配置最適化（現在は折り返しで下部に表示）

## 関連するADR

- ADR-0024: eye プロジェクト詳細ページ Scene Guide & ダッシュボードレイアウト
- ADR-0023: eye エフェクト無限ループ修正（`untrack` パターン）
- ADR-0022: eye SvelteKit ベストプラクティスリファクタリング
