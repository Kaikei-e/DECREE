# ADR-0006: DECREE Eye HUD/CIC デザインシステム適用

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREE Eye は Tailwind CSS のデフォルト gray パレットによる汎用ダークテーマで構築されていた。セキュリティ脆弱性の指揮管制ツールとしての視覚的アイデンティティがなく、SOC（Security Operations Center）ダッシュボードとして最も重要な「脅威状況の即座の把握」が配色・タイポグラフィの面で支援されていなかった。

設計にあたり、以下の 3 つの領域をリサーチした:

- **SOC ダッシュボードのベストプラクティス**: 3 段階情報階層（Critical → Moderate → Info）、プログレッシブ開示、常時表示の LIVE インジケーター
- **HUD/CIC デザイン**: 航空機の Heads-Up Display や艦艇の Combat Information Center に見られる、深い青黒背景・シアンアクセント・モノスペースタイポグラフィ・グロー/スキャンラインエフェクト
- **ダークモード UI 原則**: 純黒を避け暗い青灰色を使用、影ではなくグロー/明度で奥行き表現、高コントラスト維持

## 決定事項

DECREE Eye の全 UI コンポーネントおよびレンダラー背景に、HUD/CIC をモチーフとしたデザインシステムを適用する。Tailwind v4 の `@theme` ディレクティブでデザイントークンを定義し、カスタムユーティリティクラス（`.hud-panel`, `.hud-border-glow`, `.hud-scanlines` 等）で HUD 固有の視覚要素を実現する。

## 実装の概要

### デザイントークン基盤

`src/app.css` に Tailwind v4 `@theme` ブロックで HUD カラーシステムを定義:

- **背景階層**: `hud-void`(#050a0e) → `hud-base`(#0a1118) → `hud-surface`(#111a24) → `hud-elevated`(#182736) の 4 段階
- **アクセント**: シアン `hud-accent`(#00e5ff) を署名色として全面採用
- **セマンティックカラー**: `hud-danger`(Critical)、`hud-warning`(High)、`hud-caution`(Medium)、`hud-info`(Low)、`hud-safe`(Info/OK)
- **テキスト階層**: `hud-text`(#e0f0ff クールホワイト) → `hud-text-secondary` → `hud-text-muted` の 3 段階
- **タイポグラフィ**: JetBrains Mono（モノスペース主体）+ Inter（サンセリフ補助）

### HUD ユーティリティクラス

| クラス | 効果 |
|---|---|
| `.hud-panel` | コーナーブラケット装飾付きパネル（`::before`/`::after` で L 字ボーダー） |
| `.hud-border` / `.hud-border-glow` / `.hud-border-active` | 3 段階のグローボーダー |
| `.hud-scanlines` | CRT 風スキャンラインオーバーレイ（`repeating-linear-gradient`） |
| `.hud-header` | ミリタリー通信風セクションヘッダー（uppercase, letter-spacing, シアン） |
| `.hud-live-pulse` | LIVE インジケーター脈動アニメーション |
| `.hud-bar-glow` | スコアバーの発光エフェクト |

### コンポーネント変更

全 Svelte コンポーネントで Tailwind gray パレットを HUD トークンに置換:

- **ルートレイアウト**: `bg-hud-void` 背景、シアン Shield アイコン、uppercase モノスペースロゴ、LIVE インジケーター dot
- **FilterBar**: `hud-panel` 化、モノスペースセレクト、シアンアクティブ状態
- **DetailPanel**: `bg-hud-void` + 左辺シアングロー、`hud-header` セクション見出し
- **ScoreBreakdown**: 大きなシアンスコア表示、角張ったバー + `hud-bar-glow`（CVSS=青、EPSS=オレンジ、Reachability=緑）
- **SeverityBadge**: `rounded-sm` + 左辺 2px カラーアクセント、uppercase モノスペーストラッキング
- **NodeTooltip**: `hud-panel` + `hud-border-glow` + backdrop-blur
- **TopRisksSummary**: `hud-panel`、`hud-header`、シアンスコア数値
- **TimelineSlider**: `hud-panel`、シアントランスポートボタン、LIVE ボタン脈動

### レンダラー背景

- **ThreeSceneRenderer**: クリアカラーを `0x050a0e`（hud-void）に統一、環境光を 0.4 に減光、`THREE.GridHelper` でシアングリッド床面を追加
- **Canvas2DRenderer**: 背景 `#050a0e`、エッジ色を微弱シアン `rgba(0,229,255,0.08)`、ラベル色を `#7a9ab5`（hud-text-secondary）、ホバー色をシアンに変更
- **node-material**: エッジマテリアルを暗いティール `0x0a3050` / opacity 0.15 に変更

### フォームコントロール

`app.css` にカスタムレンジスライダー（シアンサム + グロー）、セレクトリセット、`::selection` 色、`:focus-visible` リング、スクロールバースタイリングを追加。

### Biome 設定

`biome.json` に `css.parser.tailwindDirectives: true` を追加し、`@theme` ディレクティブの解析を有効化。

## 代替案

### 1. CSS-in-JS（Emotion/styled-components）によるテーマ実装

Svelte エコシステムでは CSS-in-JS の採用率が低く、SvelteKit のサーバーサイドレンダリングとの相性も悪い。Tailwind v4 の `@theme` で十分なトークン管理が可能であり、ビルドサイズも小さく保てるため不採用。

### 2. Skeleton UI / shadcn-svelte 等のコンポーネントライブラリ

既存のダークテーマでは HUD/CIC の独特な視覚言語（コーナーブラケット、スキャンライン、グローエフェクト等）を表現できない。カスタムユーティリティクラスで実装する方がデザインの自由度が高く、依存も増えない。

### 3. CSS Custom Properties のみ（Tailwind 不使用）

トークン定義は可能だが、レスポンシブデザインやユーティリティファーストの生産性を失う。Tailwind v4 の `@theme` はカスタムプロパティをそのまま Tailwind ユーティリティクラスとして利用可能にするため、両方の利点を得られる。

## 影響・トレードオフ

### メリット

- **脅威状況の視認性向上**: セマンティックカラーによる 5 段階の severity 即座識別、LIVE インジケーターによるリアルタイム状態把握
- **プロフェッショナルな視覚的アイデンティティ**: SOC/CIC 風のインターフェースにより、セキュリティツールとしての信頼感を醸成
- **一貫したデザイン言語**: `@theme` トークンにより全コンポーネントで統一された配色・タイポグラフィ
- **ロジック変更ゼロ**: 純粋な視覚変更のため、既存の 66 テスト全パス

### デメリット・リスク

- **Google Fonts 外部依存**: JetBrains Mono と Inter を Google Fonts CDN から読み込むため、オフライン環境ではフォールバックフォントになる
- **CRT エフェクトのアクセシビリティ**: スキャンラインは `rgba(0,229,255,0.015)` と極めて微弱だが、視覚過敏なユーザーへの影響は未検証
- **カスタムクラスの学習コスト**: `.hud-panel`, `.hud-border-glow` 等のプロジェクト固有クラスを新規コントリビューターが理解する必要がある

### パフォーマンスへの影響

- **CSS サイズ**: `@theme` トークン + ユーティリティクラスの追加により CSS は微増するが、gzip 後で数百バイト程度
- **レンダリング**: `::before`/`::after` 擬似要素によるコーナーブラケットと `repeating-linear-gradient` スキャンラインは GPU 合成レイヤーで処理され、パフォーマンス影響は無視可能
- **3D シーン**: GridHelper の追加により Three.js シーンの描画負荷がわずかに増加するが、200×40 グリッドは極めて軽量
- **フォント読み込み**: Google Fonts の `display=swap` により FOUT（Flash of Unstyled Text）は発生するが、レイアウトシフトは最小限

## 今後の課題

- **フォントのセルフホスティング**: オフライン対応やプライバシー要件に応じて、JetBrains Mono / Inter をローカルにバンドルする検討
- **アクセシビリティ検証**: WCAG 2.1 AA 準拠のコントラスト比検証（特にシアンアクセント on 暗背景）
- **スキャンラインの無効化オプション**: ユーザー設定で CRT エフェクトを無効化できる仕組み
- **ダークモード/ライトモード切替**: 現状は HUD テーマ固定だが、将来的にライトモードの需要が出る可能性

## 関連する ADR

なし（DECREE Eye の初めてのデザインシステム定義）
