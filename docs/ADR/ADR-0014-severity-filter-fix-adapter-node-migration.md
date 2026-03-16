# ADR-0014: Severity フィルタ修正と adapter-static → adapter-node 移行

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

DECREE Eye の3Dビューにおいて、フィルタリング機能とデプロイメントアーキテクチャに2つの独立した問題が存在していた。

### 問題1: Severity フィルタが機能しない

FilterBar コンポーネントで severity / ecosystem / minEpss を選択しても、`appState.filters` が更新されるだけで誰もその変更を監視しておらず、Gateway API への再フェッチが発生しなかった。`+layout.svelte` の `loadProject()` は `active_only` パラメータのみを送信しており、残りのフィルタ条件は完全に無視されていた。

Gateway 側（`pg_store.go`）では `severity`, `ecosystem`, `min_epss`, `active_only` すべてのパラメータに対応した SQL WHERE 句が実装済みであり、フロントエンドの接続不備のみが原因であった。

### 問題2: adapter-static による SPA 構成

decree-eye は `@sveltejs/adapter-static` で静的 HTML にビルドし、nginx コンテナで配信する SPA 構成をとっていた。これには以下の課題があった:

- **環境変数がビルド時固定**: `VITE_GATEWAY_URL` は Vite のビルド時変数であり、デプロイ環境ごとに Docker イメージを再ビルドする必要があった
- **SSR の恩恵が得られない**: SvelteKit の SSR 機能（SEO、初期表示速度、`$env/dynamic/public`）が利用できなかった
- **nginx の運用コスト**: SvelteKit アプリに nginx リバースプロキシを挟む二重構成は不必要な複雑性をもたらしていた

## 決定事項

1. フィルタ変更を Svelte 5 の `$effect` で監視し、変更時に findings のみを再フェッチする
2. `@sveltejs/adapter-static` + nginx から `@sveltejs/adapter-node` に移行し、Node.js ランタイムで SSR 配信する
3. 環境変数を `VITE_GATEWAY_URL`（ビルド時固定）から `PUBLIC_GATEWAY_URL`（実行時解決）に移行する

## 実装の概要

### Part 1: Severity フィルタ修正

**ファイル:** `services/eye/src/routes/projects/[projectId]/+layout.svelte`

既存の `loadProject()` を2つの関数に分割した:

- `loadProject(id)`: プロジェクトメタデータ（targets, topRisks）の取得と SSE 接続を担当。プロジェクト ID 変更時に実行
- `loadFindings(id)`: フィルタ条件を含む findings の取得とグラフ再計算を担当。フィルタ変更時にも実行

フィルタ変更の監視には Svelte 5 の `$effect` を使用し、`appState.filters` の各プロパティ（`severity`, `ecosystem`, `minEpss`, `activeOnly`）を個別に読み取ることでファイングレインドなリアクティビティトラッキングを確立した:

```typescript
$effect(() => {
    const _severity = appState.filters.severity;
    const _ecosystem = appState.filters.ecosystem;
    const _minEpss = appState.filters.minEpss;
    const _activeOnly = appState.filters.activeOnly;
    const id = appState.selectedProjectId;
    if (id) loadFindings(id);
});
```

**ファイル:** `services/eye/src/lib/api/client.ts`

`getFindings()` 呼び出し時にすべてのフィルタパラメータを送信するよう修正。既存の `FindingFilterParams` インターフェースと `buildQuery()` ユーティリティがそのまま活用できたため、API クライアント自体の変更は不要だった。

### Part 2: adapter-node 移行

**パッケージ変更:**
- `@sveltejs/adapter-static` を削除、`@sveltejs/adapter-node@5.5.4` を追加

**`svelte.config.js`:**
- adapter の設定を `adapter-node` のデフォルト構成に変更（`pages`, `assets`, `fallback` 等の static 固有オプションを削除）

**環境変数の移行:**
- `services/eye/src/lib/api/client.ts` で `import.meta.env.VITE_GATEWAY_URL` を `$env/dynamic/public` の `PUBLIC_GATEWAY_URL` に置換
- `docker-compose.yml` の decree-eye サービスで `VITE_GATEWAY_URL` → `PUBLIC_GATEWAY_URL` にリネーム
- `$env/dynamic/public` はサーバーサイドで値を解決し、SSR 時にクライアントへ注入する SvelteKit の仕組みを利用

**Dockerfile:**
- nginx ベースの2ステージビルドから、Node.js ランタイムの2ステージビルドに変更
- 非 root ユーザー（`decree`）で実行するセキュリティ強化
- `pnpm prune --prod` で本番依存のみを最終イメージに含める
- ヘルスチェックは従来と同じ `/healthz` エンドポイントを使用

**ヘルスチェックエンドポイント:**
- `services/eye/src/routes/healthz/+server.ts` を新規作成
- nginx の `/healthz` 設定を SvelteKit のサーバールートで代替

**削除:**
- `services/eye/nginx.conf` — adapter-node では不要

**テスト対応:**
- `$env/dynamic/public` は vitest 環境では利用不可のため、`client.test.ts` に `vi.mock('$env/dynamic/public')` を追加

## 代替案

### フィルタ監視: debounce の導入

フィルタ変更ごとに即座に API リクエストを送信する代わりに、debounce を入れてリクエスト数を抑制する案を検討した。しかし、ドロップダウン選択によるフィルタ変更は頻度が低く（スライダーのような連続入力ではない）、ユーザーは変更直後の即時フィードバックを期待するため、debounce なしの即時再フェッチを採用した。

### 環境変数: サーバーサイドプロキシ

Gateway への API リクエストを SvelteKit のサーバーサイドでプロキシする案も検討した。これにより `PUBLIC_GATEWAY_URL` をクライアントに露出する必要がなくなる。しかし、DECREE のアーキテクチャでは Gateway が既に BFF（Backend for Frontend）として機能しており、Eye サーバーを通す二重プロキシは不要な複雑性と遅延を追加するため採用しなかった。

### adapter-auto の使用

`@sveltejs/adapter-auto` はデプロイ先に応じて自動的にアダプタを選択する。しかし、DECREE は Docker Compose でのセルフホストを前提としており、Node.js ランタイムを明示的に指定する `adapter-node` が適切である。

## 影響・トレードオフ

### メリット

- **フィルタ機能の完全動作**: severity / ecosystem / minEpss / activeOnly のすべてのフィルタが3Dビューに反映される
- **実行時設定可能**: `PUBLIC_GATEWAY_URL` により、同一 Docker イメージを異なる環境にデプロイ可能
- **SSR 対応**: 初期ページロードでサーバーサイドレンダリングが有効になり、初期表示性能が向上
- **運用の簡素化**: nginx プロセスが不要になり、SvelteKit の Node.js サーバーのみで完結

### デメリット・リスク

- **メモリ使用量の増加**: nginx と比較して Node.js プロセスはメモリ消費が大きい。ただし decree-eye のトラフィック規模では問題にならない
- **静的ファイル配信の性能**: nginx は静的ファイル配信に最適化されているが、adapter-node の組み込みサーバーはそこまで最適化されていない。CDN を前段に置く場合はこの差は無視できる

### パフォーマンスへの影響

- **フィルタ再フェッチ**: フィルタ変更ごとに Gateway API へのリクエストが発生する。Gateway 側の SQL クエリはインデックス付きカラムでの WHERE 絞り込みであり、レスポンスタイムへの影響は軽微
- **グラフ再計算**: `computeLayout()` が findings 変更ごとに実行されるが、フィルタ後のデータセットは小さくなるため、現状のパフォーマンスで十分
- **SSR オーバーヘッド**: 初回リクエスト時にサーバーサイドレンダリングが走るが、Three.js の初期化はクライアントサイドで行われるため影響は限定的

## 今後の課題

- **フィルタの URL 同期**: 現在フィルタ状態は `appState` のみで管理されており、URL パラメータに反映されない。ブラウザの戻る/進む操作やブックマークでフィルタを復元できるよう、`$page.url.searchParams` との双方向同期を検討
- **フィルタ結果のキャッシュ**: 同一フィルタ条件での再フェッチを避けるため、クライアントサイドキャッシュの導入を検討
- **Three.js チャンクの分割**: ビルド出力で nodes/5 チャンクが 586 KB と大きい。dynamic import によるコード分割を検討

## 関連するADR

- ADR-0013: Eye 3Dビューのレイアウトずれ修正とカメラフレーミング改善 — ホバー時の `display: block` 修正はこの ADR の前提
