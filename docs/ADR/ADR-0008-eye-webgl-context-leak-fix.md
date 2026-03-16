# ADR-0008: Eye WebGL コンテキストリーク & THREE.Clock 非推奨エラー修正

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-eye のブラウザコンソールで以下の問題が継続的に発生していた:

1. **`THREE.Clock` 非推奨警告の大量発火**: Three.js v0.183.2 で `THREE.Clock` が deprecated になり、`animate()` ループ内で毎フレーム警告が出力されていた（1分間に数千回）
2. **WebGL コンテキスト枯渇**: rendererType の 3D/2D 切り替えや Svelte コンポーネントの再マウント時に、古い WebGL コンテキストが解放されず蓄積。最終的に `Too many active WebGL contexts` エラーでレンダリングが停止
3. **イベントリスナーリーク**: `ThreeSceneRenderer` と `Canvas2DRenderer` の `dispose()` がイベントリスナーを除去しておらず、再マウント時にリスナーが重複登録
4. **カメラアニメーション未キャンセル**: `animateCamera()` が `requestAnimationFrame` チェーンを返さないため、dispose 後もアニメーションフレームが走り続ける可能性
5. **`$effect` cleanup 未実装**: rendererType 変更時の Svelte `$effect` が cleanup 関数を返しておらず、dispose タイミングが不安定

これらは単体では軽微だが、複合すると WebGL コンテキスト枯渇 → `No available adapters` → 可視化完全停止というクリティカルな障害に至る。

## 決定事項

`THREE.Clock` を `THREE.Timer` に移行し、WebGL コンテキストおよびイベントリスナーのリソースリークを包括的に修正する。Svelte `$effect` の cleanup パターンを導入し、コンポーネントライフサイクルに沿った確実な破棄を保証する。

## 実装の概要

影響範囲は decree-eye のレンダラー層に限定。データモデル・API・他サービスへの影響なし。

### 1. `ThreeSceneRenderer.ts` — 包括的リソース管理

**Clock → Timer 移行:**

```typescript
// Before
private clock = new THREE.Clock();

// After
private timer = new THREE.Timer();
```

- `mount()` で `this.timer.connect(document)` を呼び Page Visibility API に接続。タブ非表示時の大きなデルタ値を回避
- `animate()` で `requestAnimationFrame` の timestamp を `this.timer.update(timestamp)` に渡す
- `getElapsedTime()` → `getElapsed()` に変更（Timer API）

**animate() 構造変更:**

```typescript
// Before: rAF で自身を再帰呼出し → render は callback 外
private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.clock.getDelta();
    // ...
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
}

// After: callback 内で全処理。timestamp を Timer に渡す
private animate() {
    this.animationId = requestAnimationFrame((timestamp) => {
        this.timer.update(timestamp);
        // ... pulse animation ...
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.animate();
    });
}
```

**イベントリスナー cleanup:**

匿名関数を arrow function フィールドに変更し、`removeEventListener` で確実に除去:

```typescript
private handlePointerMove = (e: PointerEvent) => { /* ... */ };
private handleClick = (e: MouseEvent) => { /* ... */ };
```

**dispose() の包括的修正:**

```
1. cancelAnimationFrame(animationId) + カメラアニメーションキャンセル
2. timer.disconnect() + timer.dispose()
3. container.removeEventListener('pointermove' | 'click')
4. controls.dispose()
5. InstancedMesh: geometry.dispose() + material.dispose()
6. EdgeLines: geometry.dispose() + material.dispose()
7. scene.clear()
8. renderer.forceContextLoss() → renderer.dispose()  ← 順序が重要
9. DOM から canvas 要素を除去
```

`forceContextLoss()` を `dispose()` の前に呼ぶことで、ブラウザに WebGL コンテキストの即時解放を要求する。`dispose()` だけでは GC まで解放されない場合がある（three.js#17588）。

**rebuildScene() material dispose:**

`InstancedMesh.dispose()` は geometry を dispose しない。明示的に `geometry.dispose()` と `material.dispose()` を呼ぶよう修正。

### 2. `Canvas2DRenderer.ts` — イベントリスナー cleanup

同様に匿名関数を arrow function フィールドに変更し、`dispose()` で `removeEventListener` を呼ぶ。

### 3. `capability.ts` — WebGL コンテキスト解放 + 結果キャッシュ

```typescript
let cached: RendererCapability | null = null;

export async function detectCapability(): Promise<RendererCapability> {
    if (cached) return cached;
    // ...
    const gl = canvas.getContext('webgl2');
    if (gl) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        cached = 'webgl2';
        return cached;
    }
    // ...
}
```

- 検出用に作った WebGL コンテキストを `WEBGL_lose_context` 拡張で即時解放
- 結果をモジュールレベル変数にキャッシュし、2回目以降のコンテキスト作成を防止

### 4. `camera-presets.ts` — animateCamera キャンセル対応

`animateCamera()` の返り値を `() => void`（キャンセル関数）に変更:

```typescript
export function animateCamera(...): () => void {
    // ...
    tick();
    return () => cancelAnimationFrame(frameId);
}
```

`ThreeSceneRenderer` 側で `cancelCameraAnimation` フィールドに保持し、次のアニメーション開始前・dispose 時にキャンセル。

### 5. `VisualizationCanvas.svelte` — $effect cleanup

```svelte
$effect(() => {
    const _ = rendererType;
    initRenderer();
    return () => {
        renderer?.dispose();
        renderer = null;
    };
});
```

Svelte 5 の `$effect` は cleanup 関数を返すと、再実行前およびコンポーネント破棄時に呼ばれる。これにより `onMount` の return での renderer dispose は不要になり、`$effect` の cleanup に一本化。

## 代替案

### A. THREE.Clock を継続使用し、警告を抑制

`console.warn` をパッチして Clock の警告だけ握りつぶすアプローチ。コード変更が最小だが、Clock 自体のバグ（`getDelta()` を複数回呼ぶと値が変わる、Page Visibility API 非対応で復帰時に巨大デルタ値）が残るため却下。Timer への移行は Three.js 公式の推奨パス。

### B. WebGL コンテキスト解放に `canvas.width = 0` を使用

`canvas.width = 0; canvas.height = 0;` で暗黙的にコンテキストを破棄するテクニック。一部ブラウザで動作するが標準化されておらず、`forceContextLoss()` の方が明示的で信頼性が高い。

### C. capability 検出で WebGL コンテキストを作らない

`'WebGL2RenderingContext' in window` で機能検出する方法。コンテキスト作成を回避できるが、ドライバレベルで WebGL2 が使えないケース（存在はするが初期化に失敗する GPU）を検出できない。実際にコンテキストを作って即解放する現在のアプローチの方が正確。

## 影響・トレードオフ

### メリット

- WebGL コンテキスト枯渇の根本原因を排除。rendererType 切り替えを何度行ってもリークしない
- `THREE.Clock` 非推奨警告の完全消滅。コンソールがクリーンになりデバッグ効率向上
- Page Visibility API 対応により、タブ復帰時のアニメーション飛びが解消
- イベントリスナーの重複登録防止により、不要な raycasting 計算の蓄積を回避

### デメリット・リスク

- `THREE.Timer` は比較的新しい API であり、Three.js のバージョンアップで挙動が変わる可能性がある（ただし Clock は deprecated のため Timer が正式な後継）
- `animate()` の構造変更により、render と controls.update が rAF callback 内に移動。タイミング上の微差はあるが、ダンピング動作を含め実際の描画に影響はない

### パフォーマンスへの影響

- capability 検出のキャッシュにより、`createRenderer()` 呼び出し時の WebGL コンテキスト作成が初回のみに削減
- `forceContextLoss()` の呼び出しは dispose 時のみで、通常のレンダリングパフォーマンスには影響なし
- Timer は Clock と同等の計算コスト（`performance.now()` ベース）

## 今後の課題

- WebGPU レンダラー（`WebGPURenderer`）への移行時にも同等のリソース管理パターンを適用する
- InstancedMesh 以外のジオメトリ（GridHelper, Light 等）の dispose は `scene.clear()` に委ねているが、大規模シーンでは明示的な管理が必要になる可能性
- `$effect` の cleanup が非同期の `initRenderer()` とレースする可能性について、Svelte 5 の安定版で再検証

## 関連するADR

- ADR-0006: Eye HUD/CIC デザインシステム — 可視化の基盤設計
