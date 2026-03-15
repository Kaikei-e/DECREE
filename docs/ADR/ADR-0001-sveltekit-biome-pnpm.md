# ADR-0001: decree-eye のフロントエンド技術スタックを SvelteKit + Tailwind CSS + Biome + pnpm に決定

## ステータス

Accepted

## 日付

2026-03-15

## コンテキスト

decree-eye は DECREE の可視化フロントエンドであり、M5 フェーズで Three.js WebGPURenderer による 3D 脆弱性グラフと Sigma.js による 2D フォールバックを実装する予定のサービスである。

M0 基盤整備の初期段階では React + Vite の雛形を配置していたが、PLAN1.md（権威仕様）の技術選定と乖離していることが判明し、以下の課題が顕在化した。

**仕様との不整合:**
PLAN1.md は decree-eye の技術スタックとして「SvelteKit + Tailwind CSS + Bits UI / shadcn-svelte」を明記している。React エコシステム上の shadcn/ui と Svelte エコシステム上の shadcn-svelte は API が異なり、互換性がない。React を維持したまま PLAN1.md の UI コンポーネント要件を満たすことは不可能である。

**WebGPU レンダリングとの共存:**
decree-eye は Three.js WebGPURenderer を通じて Canvas を直接操作する。React の仮想 DOM は Canvas 描画には介在せず、むしろ reconciliation のオーバーヘッドが DOM 側のパネル UI 更新時に不要な負荷となる。Svelte のコンパイル時アプローチは仮想 DOM を持たないため、Three.js との共存がシンプルになる。

**開発ツールチェーンの複雑性:**
ESLint + Prettier の二重構成は、formatting rules の競合（特に `eslint-config-prettier` による無効化ルール管理）と設定ファイルの分散を招く。単一ツールで lint + format を完結させたい要求があった。

**依存解決の厳密性:**
npm の flat `node_modules` 構造は phantom dependency（直接宣言していないパッケージを暗黙的に import できてしまう問題）を許容する。DECREE は複数サービスを独立した `package.json` で管理しており、各サービスの依存境界を厳密に保ちたい。

## 決定事項

decree-eye のフロントエンド技術スタックを以下の通り決定する:

| 領域 | 採用技術 |
|---|---|
| フレームワーク | SvelteKit (Svelte 5) + `@sveltejs/adapter-static` |
| スタイリング | Tailwind CSS v4（`@tailwindcss/vite` プラグイン経由） |
| UI コンポーネント | Bits UI / shadcn-svelte |
| Lint & Format | Biome（ESLint + Prettier を完全置換） |
| パッケージマネージャ | pnpm |

## 実装の概要

### ディレクトリ構成

React の雛形（`index.html`, `src/main.tsx`, `src/App.tsx`, `vite-env.d.ts`, React 用 `eslint.config.js`）を全削除し、以下の SvelteKit 構成に置換した。

```
services/eye/
├── biome.json              # Biome lint & format 設定
├── svelte.config.js        # adapter-static（fallback: index.html で SPA 動作）
├── vite.config.ts          # @tailwindcss/vite + sveltekit plugin, port 3400
├── tsconfig.json           # extends .svelte-kit/tsconfig.json, strict: true
├── package.json            # pnpm, scripts: dev/build/check/lint/format
├── Dockerfile              # corepack + pnpm → multi-stage → nginx:alpine
├── nginx.conf              # port 3400, /healthz, SPA fallback（変更なし）
├── .tool-versions          # asdf nodejs バージョン指定
├── .dockerignore           # node_modules, .svelte-kit, build
└── src/
    ├── app.html            # SvelteKit shell（%sveltekit.head%, %sveltekit.body%）
    ├── app.css             # @import "tailwindcss"
    ├── app.d.ts            # SvelteKit App namespace 型定義
    ├── lib/index.ts        # barrel export（空）
    └── routes/
        ├── +layout.svelte  # Tailwind CSS import + children レンダリング
        └── +page.svelte    # DECREE Eye プレースホルダー
```

### adapter-static の選択理由

decree-eye は decree-gateway から SSE でデータを受信するクライアントサイドアプリケーションであり、サーバーサイドレンダリングは不要である。`adapter-static` で完全静的出力し、nginx で配信する構成は既存の Dockerfile / nginx.conf をそのまま流用でき、`fallback: 'index.html'` により SPA ルーティングも維持される。

### Docker ビルドの変更

```dockerfile
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
# pnpm install --frozen-lockfile → vite build → adapter-static で build/ に出力

FROM nginx:alpine
# build/ → /usr/share/nginx/html
```

`corepack enable` で Node.js 組み込みの pnpm サポートを有効化し、別途 pnpm をグローバルインストールする必要を排除した。`--frozen-lockfile` により CI と同一の依存ツリーを Docker ビルドでも保証する。

### Biome 設定方針

- `indentStyle: tab`, `lineWidth: 100`, `quoteStyle: single`
- `recommended` ルールセットをベースに `noUnusedImports: error` を追加
- `.svelte` ファイルでは `noUnusedVariables: off` に設定（後述のデメリットを参照）

### CI パイプラインの変更

- `pnpm/action-setup@v4` の追加（GitHub Actions で pnpm を利用可能にする）
- `npm ci` → `pnpm install --frozen-lockfile`
- `npx tsc -b` → `pnpm exec svelte-check --tsconfig ./tsconfig.json`
- `npm run lint` → `pnpm run lint`（内部で `biome check .` を実行）

### Makefile の変更

- `npm run lint` → `pnpm run lint`
- `npm test` → `pnpm test`
- `npx prettier --write` → `pnpm run format`（内部で `biome format --write .`）

## 代替案

### React + Vite を維持する

React エコシステムは巨大であり、Three.js との統合実績（react-three-fiber 等）も豊富。しかし PLAN1.md が明示的に SvelteKit + Bits UI / shadcn-svelte を指定しており、React 用の shadcn/ui とは API・設計思想が異なる。仕様との整合性を優先し却下した。

### ESLint + Prettier を維持する

ESLint v9 の flat config は従来より設定が簡潔になったものの、Prettier との責務分離（lint は ESLint、format は Prettier）により設定ファイルが 2 つに分かれる。`eslint-config-prettier` でルール競合を抑制する運用も必要。Biome は単一バイナリ・単一設定ファイルで lint + format を完結でき、実行速度も ESLint + Prettier 比で大幅に高速（Rust 実装）。設定の簡潔さと速度を優先し Biome を採用した。

### npm を維持する

npm v10 も機能的には十分だが、flat `node_modules` による phantom dependency の問題が残る。pnpm は content-addressable store によるディスク効率と、厳密なシンボリックリンク構造による依存境界の強制を提供する。DECREE の各サービスが独立した `package.json` を持つ構成では、依存の厳密性が重要と判断した。

### Bun を採用する

Bun はインストール・ビルド速度に優れるが、SvelteKit アダプタとの互換性や Docker Alpine 環境でのサポートが pnpm ほど成熟していない。MVP フェーズでは安定性を優先し見送った。

## 影響・トレードオフ

### メリット

- **PLAN1.md との整合**: 権威仕様が指定する技術スタックに準拠し、Bits UI / shadcn-svelte の採用が可能になった
- **バンドルサイズ削減**: Svelte のコンパイル時アプローチにより、React + ReactDOM のランタイム（~40KB gzip）が不要
- **Three.js との親和性**: 仮想 DOM を介さず直接 DOM / Canvas を操作でき、WebGPU レンダラーとの統合がシンプル
- **ツールチェーン簡素化**: Biome の単一バイナリで lint + format が完結。設定ファイル数の削減
- **依存の厳密性**: pnpm により phantom dependency を排除

### デメリット・リスク

- **Biome の Svelte サポートが発展途上**: Svelte 5 の `$props()` による destructuring を「未使用変数」と誤検出する。現時点では `.svelte` ファイルで `noUnusedVariables: off` とすることで回避しているが、TypeScript ファイル側の未使用変数検出は有効なままであり、影響は限定的。Biome のアップデートに追従し、サポート改善時に再有効化する
- **Svelte エコシステムの規模**: React と比較してサードパーティライブラリが少ない。ただし decree-eye の UI は Three.js によるカスタム可視化が中心であり、汎用 UI ライブラリへの依存は Bits UI / shadcn-svelte で十分カバーできる
- **Svelte 5 Runes の学習コスト**: `$state`, `$derived`, `$effect`, `$props` は React Hooks とは異なるリアクティビティモデル。ただしコンパイラが多くのエッジケースを処理するため、実装上のバグリスクは React Hooks の依存配列管理より低い

### パフォーマンスへの影響

- **可視化レンダリング**: 影響なし。Three.js は DOM フレームワークに非依存であり、Canvas 描画パスにフレームワークは介在しない
- **初期ロード**: `adapter-static` による完全静的出力 + Svelte の軽量ランタイムにより、React 構成と比較して改善見込み
- **HMR**: Vite + SvelteKit の HMR は React Fast Refresh と同等以上の速度

## 今後の課題

- Biome の Svelte サポート改善に追従し、`.svelte` ファイルの `noUnusedVariables` を再有効化する
- M5 フェーズで Three.js WebGPURenderer と Svelte コンポーネントの統合パターン（Canvas 管理、リアクティブデータバインディング、ライフサイクル連携）を確立する
- shadcn-svelte のテーマカスタマイズで DECREE カラーパレット（Critical=#FF1744, High=#FF9100, Medium=#FFD600, Low=#448AFF, Clean=#00E676）を適用する
- `adapter-static` から `adapter-node` への移行可能性を M5 で再評価する（SSR が必要になった場合）

## 関連するADR

なし（初回 ADR）
