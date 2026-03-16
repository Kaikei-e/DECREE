# ADR-0026: eye 3D 可視化を Threat Skyline（カラムノード＋ディストリクトプレート）に再設計

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

ADR-0024/0025 で導入した 3D 脆弱性マップは、各脆弱性インスタンスを球体（`SphereGeometry`）で表現し、ターゲットごとに水平レーンへ配置する構成だった。運用を重ねる中で以下の課題が明らかになった:

- **高さ情報の読み取り精度が低い**: 球体は接地点が不明瞭で、DECREE Score に対応する Y 座標（高さ = 緊急度）の比較が困難だった。ノードが密集すると、どの球がより高い位置にあるのか一目で判別しにくい
- **ターゲット境界の不明瞭さ**: レーン配置は概念的に存在するが、視覚的な領域境界がなく、どのノードがどのターゲットに属するかを空間的に把握しにくかった。特にターゲット数が多い場合、隣接レーンのノードが混在して見えていた
- **都市景観メタファーとの乖離**: セキュリティ運用者にとって「どこが危険な地区か」を俯瞰する行為は、都市の治安マップを読む行為に近い。球体の点群はこのメンタルモデルと一致せず、直感的な空間把握を阻害していた

これらの課題を解決し、「危険な地区ほど高いビルが立ち並ぶスカイライン」という直感的なメタファーで脆弱性の空間分布を表現する必要があった。

## 決定事項

3D 可視化のノード表現を球体からカラム（六角柱 `CylinderGeometry`）に変更し、ターゲットクラスタごとにディストリクトフロアプレート（床板）を配置する「Threat Skyline」デザインに再設計する。カラムの高さが DECREE Score、色が重大度、明るさが EPSS を表現し、都市のスカイラインのように一望できる構成とする。

## 実装の概要

### ThreeSceneRenderer.ts — ノードジオメトリの変更

**球体 → 六角柱:**

```typescript
// Before
const NODE_GEOMETRY = new THREE.SphereGeometry(0.3, 16, 12);

// After
const NODE_GEOMETRY = new THREE.CylinderGeometry(0.16, 0.26, 1, 6, 1, false);
```

上端半径 `0.16`、下端半径 `0.26` のわずかにテーパーした六角柱を採用。6 面体は円柱より角があり建築物のシルエットに近く、かつポリゴン数を低く抑えられる。

**カラムのスケーリング:**

各ノードの高さは `Math.max(MIN_COLUMN_HEIGHT, node.position.y)` で決定し、最低でも `0.6` の視認性を確保する。幅は `Math.min(MAX_COLUMN_WIDTH, 0.18 + node.visual.size * 0.12)` でキャップし、密集領域でのカラム重畳を抑制する。Y 座標は `height / 2` に設定し、カラムの底面がフロアプレートに接地するよう調整した。

**色の EPSS ブレンド:**

```typescript
color.set(node.visual.color).lerp(new THREE.Color(0xffffff), node.epssScore * 0.18);
```

重大度ベースの色に EPSS スコアに比例した白色を加算し、同一重大度バンド内でのエクスプロイト確率の差異をグロー（明度差）として視覚化する。

### ThreeSceneRenderer.ts — ディストリクトシステム

`createDistrictGroup()` メソッドを新設し、`GraphModel.clusters` の各クラスタに対して 3 つの要素を生成する:

1. **フロアプレート**: `BoxGeometry` による半透明の暗色床板（`0x081723`, opacity `0.92`）。クラスタ内ノードの XZ 範囲にパディング（X: `1.8`, Z: `1.6`）を加えた領域を覆い、最小サイズ（幅 `2.4`, 奥行 `2.8`）を保証する。Y 座標は `-0.04` でグリッドの直下に配置
2. **アウトライン**: `LineBasicMaterial` によるフロアプレート外周線（`0x1a5d8f`）。ディストリクトの領域境界を明確に表示
3. **ビーコン**: クラスタ中心から垂直に伸びる短いライン（`0x00e5ff`, 高さ `0.9`）。俯瞰カメラからディストリクトの重心を特定するランドマーク

ディストリクトグループは `THREE.Group` にまとめ、グラフモデル更新時に `disposeDistricts()` で前回分のジオメトリ・マテリアルを適切に解放してからリビルドする。

### ThreeSceneRenderer.ts — ライティングの再調整

スカイラインの立体感を強調するため、ライティング構成を変更:

| ライト | Before | After |
|---|---|---|
| Ambient | `0xffffff`, intensity `0.4` | `0xffffff`, intensity `0.48` |
| Directional（主光源） | `0xffffff`, intensity `0.8`, pos `(10,20,10)` | `0x7ddcff`（寒色）, intensity `1.15`, pos `(12,24,10)` |
| Rim（逆光） | なし | `0xff7a18`（暖色）, intensity `0.35`, pos `(-10,12,-14)` |
| Grid | `0x0a2030` / `0x061520` | `0x12314a` / `0x07131d`（やや明るく） |

主光源に寒色、リムライトに暖色を割り当てることで、カラム側面にコントラストが生まれ、高さの比較が容易になる。

### ThreeSceneRenderer.ts — ポインタハンドラの null 安全化

`handlePointerMove` と `handleClick` で `this.container` の non-null assertion (`!`) を除去し、ガード節 `if (!this.container) return;` に置換した。マウント前やディスポーズ後のイベント発火時にランタイムエラーを防止する。

### SceneGuide.svelte — コンパクトレイアウトと用語更新

- ヘッダー行を簡素化: タイトル・バッジ・トグルボタンのみの 1 行構成に変更（説明テキスト `h2` / `p` を廃止）
- パディング・マージンを縮小（`px-4 py-4` → `px-3 py-3`、`gap-4` → `gap-3`）
- KPI カードを全幅の 4 カラムグリッドに変更（右カラムの Reading Keys を廃止）
- 「Always-On Reading Keys」を展開ガイド内の「Reading keys」セクションに移動
- 用語を Threat Skyline コンセプトに統一:
  - Orb → Column
  - Cluster position → District layout
  - target lanes → target districts
  - Severity color → Column height（高さの意味を強調）
  - Glow intensity → Color and glow

### +page.svelte — UI テキストの更新

- 「Spatial Inspection」→「Threat Skyline」に改称
- 操作ガイドテキストを地区・スカイラインメタファーに更新
- Read Order の「target lanes」→「target districts」、「DECREE urgency」→「DECREE skyline」
- 凡例チップの「Orb = instance」→「Column = instance」

### テスト

**ThreeSceneRenderer.test.ts:**

- `sampleGraph` フィクスチャ（2 ノード・1 クラスタ）を追加し、`setGraphModel()` 後の内部状態を検証可能にした
- **skyline column geometry テスト**: `instancedMesh.geometry.type` が `'CylinderGeometry'` であることを検証
- **district group テスト**: `districtGroup` が non-null で、`children.length > 0` であることを検証
- 既存の disposal 順序テストで non-null assertion を除去し、`expect().toBeDefined()` + ガード `throw` に変更

**Canvas2DRenderer.test.ts:**

- `container.querySelector('canvas')!` の non-null assertion を除去し、明示的な null チェック + `throw` に変更

### データモデルへの影響

なし。フロントエンド（eye）のみの変更であり、fact / resource / projection いずれの層にも影響しない。

### 可視化への影響

Three.js WebGLRenderer のノード描画パイプラインに直接的な変更がある。Sigma.js フォールバックは 2D レンダリングのため今回の変更の影響を受けない。WebGPU 固有の機能は使用しておらず、WebGL コンテキストで動作する。

## 代替案

### A: 球体を維持し、影（ドロップシャドウ）で高さを表現する

球体の直下に半透明の円を投影し、影の大きさや距離で高さを暗示する案。実装が軽量だが、ノードが密集した場合に影が重なり合い、個別の高さ比較がかえって困難になる。また「スカイライン」の直感的な読み取りには至らないため不採用。

### B: 直方体（BoxGeometry）をカラムとして使用する

六角柱の代わりに直方体を使う案。実装は最も単純だが、都市景観のビルディングとの類似性が強すぎ、隣接カラム同士のエッジが視覚的に融合しやすい。六角柱はエッジに微妙な角度差があるため、密集時でも個々のカラムが区別しやすい。

### C: ディストリクトを色分けのみで表現する（フロアプレートなし）

ノードの色やグループ ID でターゲット境界を示す案。3D 空間上で色だけでは領域の物理的な広がりが伝わらず、「どこからどこまでが同じターゲットか」を俯瞰視点で把握しにくい。フロアプレートによる物理的な領域表現が必要と判断した。

## 影響・トレードオフ

### メリット

- カラムの高さで DECREE Score を直接比較できるため、「最も危険な脆弱性はどれか」を一望で判断できる
- ディストリクトフロアプレートにより、ターゲット境界が明確になり「どのリポジトリが最も赤いか」を空間的に把握できる
- リムライトの追加により、カラム側面のコントラストが向上し、重なり合うカラムの前後関係が識別しやすくなった
- SceneGuide のコンパクト化により、3D シーンの表示領域がさらに拡大した
- null 安全化により、エッジケースでのランタイムエラーリスクが低減した

### デメリット・リスク

- 六角柱は球体より頂点数が少ない（72 vs 3,072 per node）が、ディストリクトプレート・アウトライン・ビーコンの追加によりドローコール数が増加する。ノード数に対してクラスタ数は少ないため、実用上の影響は軽微
- SceneGuide から常時表示の Reading Keys を展開ガイド内に移動したため、初見ユーザーがガイドを展開しないと「Column = instance」の対応関係を見落とす可能性がある（ただし +page.svelte の右下凡例チップで最低限のキーは常時表示）
- 「Threat Skyline」という独自用語を導入したため、プロジェクト内のドキュメント・UI テキストの統一メンテナンスが必要になる

### パフォーマンスへの影響

- ノードジオメトリの頂点数は大幅に減少（球体 3,072 → 六角柱 72 per instance）。InstancedMesh の頂点バッファが縮小し、GPU メモリ使用量とドローコール負荷が軽減される
- ディストリクトプレート・アウトライン・ビーコンはクラスタ数に比例（通常 1〜10 程度）のため、追加のドローコールは無視できるレベル
- `disposeDistricts()` による適切なリソース解放で、グラフモデル更新時のメモリリークを防止

## 今後の課題

- ディストリクトプレートにターゲット名ラベル（`TextGeometry` または HTML オーバーレイ）を追加し、プレートの所属を直接表示する
- カラムのホバー/選択時にハイライトアニメーション（高さのパルスや発光エフェクト）を追加する
- ディストリクト間の相対的なリスク比較を支援する、プレートの色温度によるヒートマップ表現
- Sigma.js フォールバック側にも district 概念を反映する（2D でのグループ囲み線など）
- カラム密集時の LOD（Level of Detail）切り替え: 遠景では代表カラム 1 本にマージする等の最適化

## 関連するADR

- ADR-0025: eye SceneGuide の折り畳み化とダッシュボードレイアウト再構成
- ADR-0024: eye プロジェクト詳細ページ Scene Guide & ダッシュボードレイアウト
- ADR-0013: eye 3D レイアウトシフト・カメラフレーミング修正
- ADR-0008: eye WebGL コンテキストリーク修正
