# ADR-0022: decree-eye SvelteKit ベストプラクティス リファクタリング

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-eye は既に Svelte 5 の Runes (`$state`, `$derived`, `$effect`, `$props`) を全面採用しており、コンポーネント層の移行は完了していた。しかし、**SvelteKit のデータローディングパターンを全く活用していない**という構造的な問題が残っていた。

具体的には以下の課題があった:

1. **全データ取得がクライアントサイドの `onMount` / `$effect` 内で実行** — SvelteKit の `load` 関数を使わないため、SSR / プリロード / ストリーミングの恩恵を受けられない
2. **`appState` がモジュールレベルのシングルトンで全状態を管理** — `projects` 配列や `loading` フラグなど、本来ページ単位でライフサイクルを持つべきデータがグローバルに漏洩。SSR 環境ではリクエスト間で状態がリークするリスクがある
3. **`onMount` / `onDestroy` と `$effect` の混用** — Svelte 5 では `$effect` のクリーンアップ関数で統一できるが、旧パターンが残存していた
4. **環境変数アクセスが不統一** — `$env/dynamic/public` と `import.meta.env.VITE_*` が混在
5. **`ApiClient` クラスがステートレス** — インスタンスメソッドにする意味がなく、SvelteKit `load` 関数から渡される `fetch` を受け取れない設計だった

これらは機能上の問題ではないが、SvelteKit アプリケーションとしての「正しさ」を欠いており、将来の SSR 対応やパフォーマンス最適化の障壁になる。

## 決定事項

SvelteKit のデータローディングパターン (`load` 関数 + `data` props) を全面採用し、グローバル状態を UI 状態のみに限定する。`onMount` / `onDestroy` は `$effect` のクリーンアップに統一する。

## 実装の概要

### Phase 1: ルートリダイレクト

`src/routes/+page.svelte` の `onMount(() => goto('/projects'))` を廃止し、`+page.ts` で SvelteKit 標準の `redirect(307, '/projects')` を使用するように変更した。これにより、サーバーサイドでもクライアントサイドでも一貫したリダイレクトが行われる。

### Phase 2: Projects 一覧の load 関数化

`src/routes/projects/+page.ts` を新規作成し、`load` 関数内で `getProjects(fetch)` を呼び出すようにした。`+page.svelte` は `let { data } = $props()` でデータを受け取り、`onMount` と `appState.projects` への依存を完全に除去した。

`ssr = false` を設定している理由は、gateway がサーバーサイドからアクセスできない（Docker ネットワーク構成上の制約）ため。将来 Docker 内部 DNS を設定すれば `ssr = true` に切り替え可能。

### Phase 3: プロジェクト詳細の load 関数化

`src/routes/projects/[projectId]/+layout.ts` を新規作成し、targets / findings / topRisks を `Promise.all` で並行取得するようにした。`+layout.svelte` は load データから初期状態を設定し、SSE 接続やフィルター変更による再取得はクライアントサイドの `$effect` に残した。

### Phase 4: appState のスリム化

グローバル状態 (`appState`) から以下を削除した:
- `projects` — load 関数経由でページに直接渡される
- `loading` — SvelteKit の `navigating` 状態に置き換え
- `selectedProject` (derived) — 参照元がなくなったため不要

残した状態は全て UI 操作に紐づくクライアント限定の値:
- `graphModel`, `selectedNodeId`, `selectedFindingDetail`, `filters`, `rendererType`
- `targets`, `findings` — SSE による動的更新のため appState に残す

### Phase 5: ライフサイクル関数の統一

- `VisualizationCanvas.svelte`: `onMount` 内の `ResizeObserver` を `$effect` のクリーンアップに統合
- `[projectId]/+layout.svelte`: `onDestroy` の `sseManager.disconnect()` を `$effect` の return 関数に統合

### Phase 6: 環境変数アクセスの統一

`sse-manager.svelte.ts` の `import.meta.env.VITE_GATEWAY_URL` を `$env/dynamic/public` の `PUBLIC_GATEWAY_URL` に統一。`client.ts` と同じパターンにした。

### Phase 7: ApiClient の関数ベース化

`ApiClient` クラスを名前付きエクスポート関数に変換した。各関数は `customFetch` パラメータをオプションで受け取り、SvelteKit `load` 関数から渡される `fetch` を利用できるようにした。

```ts
// Before
export class ApiClient {
  getProjects(): Promise<Project[]> { ... }
}
export const api = new ApiClient();

// After
export function getProjects(customFetch: typeof fetch = fetch): Promise<Project[]> { ... }
```

### Phase 9: ナビゲーションインジケーター

`src/routes/+layout.svelte` に `$app/state` の `navigating` を追加し、ページ遷移中に画面上部にアニメーション付きのプログレスバーを表示するようにした。

### 変更ファイル一覧

| ファイル | 操作 |
|----------|------|
| `src/routes/+page.ts` | 新規 — redirect |
| `src/routes/+page.svelte` | 編集 — onMount 削除 |
| `src/routes/+layout.svelte` | 編集 — navigating indicator 追加 |
| `src/routes/projects/+page.ts` | 新規 — load 関数 |
| `src/routes/projects/+page.svelte` | 編集 — data props 受取 |
| `src/routes/projects/[projectId]/+layout.ts` | 新規 — load 関数 |
| `src/routes/projects/[projectId]/+layout.svelte` | 編集 — load data 統合, $effect cleanup |
| `src/routes/projects/[projectId]/+page.svelte` | 編集 — topRisks を data から取得 |
| `src/lib/state/app.svelte.ts` | 編集 — projects/loading 削除 |
| `src/lib/state/sse-manager.svelte.ts` | 編集 — env 統一 |
| `src/lib/api/client.ts` | 編集 — 関数ベース化 |
| `src/lib/components/VisualizationCanvas.svelte` | 編集 — onMount → $effect |
| `src/lib/state/app.svelte.test.ts` | 編集 — テスト修正 |
| `src/lib/api/client.test.ts` | 編集 — テスト修正 |

## 代替案

### SSR を有効にする (`ssr = true`)

SvelteKit の最大の利点は SSR によるパフォーマンス向上だが、現状の Docker Compose 構成では decree-eye コンテナから decree-gateway コンテナへの名前解決ができないため、`ssr = false` とした。将来 Docker ネットワークエイリアスやサービスメッシュを導入すれば SSR を有効化できる。load 関数パターンを先行導入しておくことで、その切り替えは `ssr = false` の行を削除するだけで済む。

### appState を完全に廃止し Context API に移行

SvelteKit では `getContext` / `setContext` を使ったリクエストスコープの状態管理が推奨される。しかし、decree-eye では SSE によるリアルタイム更新で `graphModel` を頻繁に書き換える必要があり、Context API ではコンポーネントツリー外（SSE コールバック）からの更新が煩雑になる。クライアント限定の UI 状態としてモジュールレベルのシングルトンを維持する判断をした。

### fetch ラッパーを SvelteKit の `handleFetch` フックに移す

`hooks.client.ts` でベース URL の付与やエラーハンドリングを一元化する案。しかし現時点では API クライアントの関数が十分にシンプルであり、フックレイヤーの追加は過剰と判断した。

## 影響・トレードオフ

### メリット

- **SvelteKit のデータフローに準拠** — `load` → `data` → コンポーネントの一方向フローにより、データの出所が明確になった
- **SSR 対応への準備完了** — `ssr = false` を外すだけで SSR が有効化できる構造
- **グローバル状態の縮小** — `appState` から 3 プロパティ（`projects`, `loading`, `selectedProject`）を削除。SSR 時のリクエスト間リークリスクを排除
- **ライフサイクル管理の統一** — `$effect` のクリーンアップに一本化したことで、リソースリーク（SSE 切断忘れ、ResizeObserver 解除忘れ）が起きにくくなった
- **API 関数の柔軟性向上** — `customFetch` パラメータにより、SvelteKit の load 関数から渡される enhanced `fetch` を利用でき、SvelteKit のキャッシュやクレデンシャル管理と統合可能

### デメリット・リスク

- **`ssr = false` の制約** — 現時点で SSR の恩恵を実際には享受できない。初期表示はクライアントサイド fetch に依存したまま
- **load 関数と $effect の二重データ取得** — フィルター変更時は `$effect` 内で再取得するため、初回ロード（load 関数）と動的更新（$effect）の二系統が存在する。これは SvelteKit の `invalidate` パターンで将来統一可能

### パフォーマンスへの影響

- load 関数内で `Promise.all` による並行取得を行っているため、初回データ取得の待ち時間は短縮される（以前は逐次実行だった）
- `navigating` インジケーターの追加により、ページ遷移中のユーザー体験が向上
- 可視化レンダリング（Three.js / Canvas2D）への影響はなし — レンダラーのライフサイクルは変更していない

## 今後の課題

- **SSR 有効化** — Docker ネットワーク構成を整備し `ssr = true` に切り替える
- **`invalidate` パターンの導入** — フィルター変更時の再取得を SvelteKit の `invalidate` / `depends` メカニズムに統合し、load 関数に一本化する
- **Three.js チャンクの分割** — ビルド時に 600KB 超のチャンク警告が出ている。`import()` による動的インポートでコード分割を検討する
- **エラーバウンダリの強化** — load 関数の例外を SvelteKit の `+error.svelte` で適切にハンドリングする

## 関連するADR

- ADR-0020: gateway リファクタリング（decree-eye が接続する API の設計元）
