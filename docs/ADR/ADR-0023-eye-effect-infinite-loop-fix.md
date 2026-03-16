# ADR-0023: decree-eye `$effect` 無限ループ修正 (`effect_update_depth_exceeded`)

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

ADR-0022 のリファクタリングにより、decree-eye は SvelteKit のデータローディングパターン (`load` 関数 + `data` props) を全面採用し、ライフサイクル管理を `$effect` に統一した。しかし、この移行後にブラウザコンソールで `effect_update_depth_exceeded` エラーが発生し、フロントエンドがクラッシュする問題が確認された。

これは Svelte 5 のリアクティビティシステムにおける無限ループである。`$effect` ブロック内で呼び出した関数が、`$state` を同期的に **読み取り** かつ **書き込み** すると、その読み取りがエフェクトの依存関係として追跡され、書き込みがエフェクトの再実行をトリガーし、無限ループが発生する。

### 原因の詳細

**主要原因:** `[projectId]/+layout.svelte` の第 1 エフェクト（SSE 接続）

```
$effect 実行
  → sseManager.connect(id) を呼び出し
    → connect() 内で disconnect() を呼び出し
      → disconnect() が $state 変数 `connection` を読み取り（if ガード）← 追跡される
    → connect() が `connection = createSSEConnection(...)` で $state を書き込み
  → 書き込みにより $effect が再トリガー → ∞
```

**二次的リスク:** 第 2 エフェクト（フィルター変更時の再取得）

`loadFindings(id)` 内で `appState.filters.*` を同期的に読み取ってから `await` に到達する。これらの読み取りはエフェクト内で明示的に読み取っている値と同一であるため、新しい依存関係は追加されないが、関数内部の実装に依存した脆い構造であり、将来の変更で破綻するリスクがあった。

## 決定事項

Svelte 5 の `untrack()` を使用して、`$effect` 内の副作用的な関数呼び出しがリアクティブ依存関係を追加しないようにする。エフェクトの依存関係は、`untrack()` の外側で明示的に読み取った値のみとする。

## 実装の概要

### 変更ファイル

`services/eye/src/routes/projects/[projectId]/+layout.svelte` — 1 ファイルのみの変更。

### 修正内容

1. `svelte` から `untrack` をインポート
2. 第 1 エフェクト: `appState` への代入と `sseManager.connect()` の呼び出しを `untrack()` で囲む。`projectId` のみが依存関係として残る
3. 第 2 エフェクト: `loadFindings(id)` の呼び出しを `untrack()` で囲む。フィルター値と `selectedProjectId` の読み取りはエフェクト直下に残し、依存関係を明示的に維持する

```svelte
// 第 1 エフェクト — projectId の変更のみで再実行
$effect(() => {
    const id = projectId;
    if (!id) return;

    untrack(() => {
        appState.selectedProjectId = id;
        appState.targets = data.targets;
        appState.findings = data.findings;
        appState.graphModel = computeLayout(data.findings, data.targets);
        sseManager.connect(id);
    });

    return () => {
        sseManager.disconnect();
    };
});

// 第 2 エフェクト — フィルター値の変更のみで再実行
$effect(() => {
    const _severity = appState.filters.severity;
    const _ecosystem = appState.filters.ecosystem;
    const _minEpss = appState.filters.minEpss;
    const _activeOnly = appState.filters.activeOnly;
    const id = appState.selectedProjectId;
    if (id) untrack(() => loadFindings(id));
});
```

### 調査の結果変更不要と判断したファイル

| ファイル | 理由 |
|----------|------|
| `VisualizationCanvas.svelte` | `$effect` 内の非同期 IIFE が自然にリアクティブ追跡を断ち切っている |
| `app.svelte.ts` | `$state` 定義のみ。読み書きパターンに問題なし |
| `sse-manager.svelte.ts` | SSE 接続管理の `$state` 定義。呼び出し元での `untrack` で解決 |
| `timeline.svelte.ts` | 状態定義のみ |
| `FilterBar.svelte`, `TimelineSlider.svelte` | イベント駆動のみで `$effect` ループなし |

## 代替案

### `$effect` を `$effect.pre` に置き換える

`$effect.pre` は DOM 更新前に実行されるが、依存関係追跡のメカニズムは同一であるため、無限ループの根本原因は解決しない。

### `tick()` で非同期化して追跡を断ち切る

```js
$effect(() => {
    const id = projectId;
    if (!id) return;
    tick().then(() => { sseManager.connect(id); });
});
```

`tick()` 後のコールバックはリアクティブスコープ外で実行されるため追跡は断ち切れるが、マイクロタスクの遅延が入り、クリーンアップ関数との実行順序が不確定になる。`untrack()` の方が同期的かつ意図が明確。

### `sseManager.connect()` 内部で `$state` の読み書きを分離する

`disconnect()` 内の `if (connection)` ガードをローカル変数にキャッシュするなど、SSE マネージャー側で問題を回避する案。しかし、これは呼び出し元の `$effect` が暗黙的に内部実装に依存する構造を残すため、脆い。エフェクトの依存関係はエフェクト側で明示的に制御すべきであり、`untrack()` はそのための Svelte 公式 API。

## 影響・トレードオフ

### メリット

- **無限ループの解消** — `effect_update_depth_exceeded` エラーが発生しなくなり、プロジェクト詳細ページが正常に描画される
- **依存関係の明示化** — `untrack()` の外側で読み取った値のみがエフェクトの依存関係であることが、コード上で視覚的に明確になった
- **最小限の変更** — 1 ファイル、import 追加 + 2 箇所の `untrack()` ラップのみ。既存のデータフローやコンポーネント構造に影響しない

### デメリット・リスク

- **`untrack()` の意図を理解する必要がある** — Svelte 5 の `untrack()` はまだ広く知られた API ではなく、チームメンバーが意図を見落とす可能性がある。ただし、Svelte 5 公式ドキュメントで推奨されているパターンであり、コメントで補足済み
- **`sseManager` 内部の `$state` 変更がエフェクトから見えなくなる** — SSE 接続状態の変更でエフェクトを再実行したい場合は、別途明示的な依存関係が必要になる。現時点ではその要件はない

### パフォーマンスへの影響

- 無限ループの解消により、CPU 使用率の異常な上昇が解消される
- `untrack()` 自体のオーバーヘッドはゼロに等しい（リアクティブコンテキストのフラグを一時的に無効化するのみ）
- 可視化レンダリング（Three.js / Canvas2D）への影響はなし

## 今後の課題

- **`invalidate` パターンへの移行** — ADR-0022 でも今後の課題として挙げたが、フィルター変更時の再取得を SvelteKit の `invalidate` / `depends` に統合すれば、第 2 エフェクト自体が不要になり、`untrack()` の必要性も消える
- **SSE マネージャーのリアクティブ設計の見直し** — `$state` をモジュールレベルで持つ現在の設計は、`$effect` からの呼び出し時に意図しない依存関係を生みやすい。将来的にクラスベースの Svelte 5 パターン (`class SSEManager { connection = $state(...) }`) に移行し、`$effect` との相互作用を整理することを検討する

## 関連するADR

- ADR-0022: decree-eye SvelteKit ベストプラクティス リファクタリング（本修正の原因となったリファクタリング）
