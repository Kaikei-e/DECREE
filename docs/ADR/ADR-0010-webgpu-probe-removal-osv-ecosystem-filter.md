# ADR-0010: WebGPU probe 削除と OSV クエリの Unknown ecosystem フィルタリング

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

ADR-0009 で OSV API クエリの `purl` 配置バグとプロジェクト重複問題を修正したが、デプロイ後も2つの問題が残存していた:

### 問題A: ブラウザコンソールの "No available adapters" メッセージ

eye の `capability.ts` が `navigator.gpu.requestAdapter()` を呼び出すことで、WebGPU 非対応環境のブラウザ GPU プロセスが "No available adapters" をコンソールに出力していた。このメッセージは GPU プロセスレベルで発生するため、JavaScript の try-catch では抑制不可能である。

実際の Three.js レンダラーは `ThreeSceneRenderer` で `WebGLRenderer` を使用しており、WebGPU 検出結果は利用されていない。検出ロジックは将来の WebGPURenderer 移行を見越した実装だったが、現時点では不要なプローブがユーザーに混乱を与えていた。

### 問題B: OSV API 400 エラーの残存

ADR-0009 の purl 配置修正後もスキャンが失敗し続けていた。調査の結果、FIM リポジトリの SBOM 583パッケージのうち6件が `Ecosystem::Unknown`（syft がファイルパスとして検出した `.yaml`, `.mod`, `pnpm-lock.yaml` 等）であり、これらが `{"package":{"name":"...","ecosystem":""},"version":"..."}` として OSV API に送信され、バッチ全体が 400 "Invalid query" で拒否されていた。

OSV batch API はバッチ内の1件でも不正なクエリがあるとバッチ全体を拒否する仕様であるため、577件の正常なクエリも道連れで失敗していた。これは ADR-0009 の「今後の課題」で予測された問題そのものである。

## 決定事項

1. eye の WebGPU 検出プローブを削除し、`RendererCapability` 型から `'webgpu'` を除去する
2. scanner の OSV バッチクエリ構築時に、ecosystem が空・name が空・version が空のパッケージをフィルタリングし、1:1 のレスポンスマッピングを維持する
3. `decree.yaml` から存在しないコンテナターゲット (`example-api`) を削除する

## 実装の概要

### 問題A: WebGPU probe 削除（eye 可視化層）

**`services/eye/src/lib/renderer/capability.ts`**:
- `navigator.gpu.requestAdapter()` を呼び出す WebGPU 検出ブロック（8-18行）を削除
- WebGL2 → canvas2d のフォールバックチェーンのみ残存

**`services/eye/src/lib/renderer/types.ts`**:
- `RendererCapability` 型から `'webgpu'` を削除: `'webgl2' | 'canvas2d'`

**`services/eye/src/lib/renderer/factory.ts`**:
- `cap === 'webgpu' ||` 分岐を削除。`cap === 'webgl2'` のみで `ThreeSceneRenderer` を生成

**`services/eye/src/lib/renderer/capability.test.ts`**:
- WebGPU 関連の2テスト（`returns webgpu when navigator.gpu is available`, `falls back to webgl2 when webgpu fails`）を削除
- WebGL2 コンテキスト検出テストを追加
- canvas2d フォールバック・キャッシュテストは維持

### 問題B: Unknown ecosystem フィルタリング（スキャンパイプライン: OSV/NVD照合ステージ）

**`services/scanner/src/osv/client.rs`** の `query_batch` メソッドを再設計:

1. **フィルタリング**: `filter_map` ではなくインデックストラッキング方式を採用。各パッケージについて:
   - purl あり → purl パスでクエリ生成、インデックスを記録
   - purl なし + 有効な ecosystem/name/version → ecosystem パスでクエリ生成、インデックスを記録
   - purl なし + ecosystem/name/version のいずれかが空 → `warn!` ログ出力、スキップ

2. **1:1 マッピング維持**: パイプラインの `sbom.packages.iter().zip(osv_results.iter())` が正しく動作するよう、スキップされたパッケージの位置に空の `OsvBatchResult { vulns: vec![] }` を挿入

3. **空チャンクスキップ**: フィルタ後にクエリが0件になったチャンクは API 呼び出しをスキップし、チャンク全体に空結果を充填

**`decree.yaml`**:
- 存在しない `example-api` コンテナターゲットを削除
- DB から `example-web`, `example-api` の stale ターゲットレコードを手動削除

## 代替案

### 問題A: WebGPU probe

**案A: `requestAdapter()` 呼び出しを維持し、コンソール出力を無視**
技術的には無害だが、開発者がコンソールでデバッグする際にノイズとなる。エラーメッセージの存在は「何かが壊れている」という誤った印象を与え、ユーザーからの問い合わせコストが発生する。WebGPURenderer は現在使用していないため、不要なコードは削除する方が適切。

**案B: WebGPU 検出を残しつつ `console.error` をパッチして抑制**
GPU プロセスレベルのメッセージは JavaScript から制御できない。仮にできたとしても、他の正当なエラーも見逃すリスクがある。

**案C: WebGPURenderer を即座に実装して WebGPU probe を活用**
将来的にはこの方向に進むが、現時点では Three.js の WebGPURenderer は安定版に至っておらず、段階的な移行が必要。ADR-0008 で WebGL コンテキストリーク修正を行ったばかりであり、レンダラー変更は別フェーズで行う。

### 問題B: Unknown ecosystem フィルタ

**案A: syft の出力段階でファイルパスエントリをフィルタ**
SBOM の忠実性が損なわれる。依存グラフの構築にはファイルパスエントリも有用な場合があり、OSV クエリの入力段階でフィルタする方が関心の分離として適切。

**案B: OSV API をパッケージごとに個別呼び出し（バッチを使わない）**
1件のエラーがバッチ全体を巻き込む問題は解決するが、583回の HTTP リクエストはレイテンシとレート制限の観点で非現実的。

**案C: ecosystem マッピングテーブルを拡充して Unknown を減らす**
長期的には有効だが、syft がファイルパスとして検出するエントリ（`go.mod`, `pnpm-lock.yaml` 等）は本質的に「パッケージ」ではないため、マッピングよりフィルタが正しい対処。

## 影響・トレードオフ

### メリット

- "No available adapters" メッセージが消え、ブラウザコンソールがクリーンになる
- FIM リポジトリのスキャンが成功し、45件の脆弱性 finding が `current_finding_status` に到達
- 583パッケージ中577件が正常にクエリされ、6件のみが明示的な warn ログ付きでスキップされる
- `decree.yaml` のターゲット定義とDB状態が一致する

### デメリット・リスク

- WebGPU 検出を削除したため、将来 WebGPURenderer に移行する際は `capability.ts` に検出ロジックを再追加する必要がある。ただし Three.js の WebGPU 対応が安定した時点での作業となるため、現時点のコード削除がテクニカルデットになるリスクは低い
- Unknown ecosystem のパッケージは脆弱性チェック対象外となる。ファイルパスエントリが大半だが、将来 syft が新しい ecosystem をサポートした場合に scanner 側のマッピングが追いつかないと取りこぼしが発生する可能性がある

### パフォーマンスへの影響

- WebGPU probe の削除により、eye の初回レンダラー生成が `requestAdapter()` の await 分（数百ms〜数秒）短縮される
- OSV クエリのフィルタリングにより、不正なクエリによるバッチ全体の再試行が発生しなくなる。583パッケージのバッチが約2秒で完了している
- stale ターゲットの削除により、oracle が無駄なスキャンジョブを発行しなくなり、scanner コンテナのリソース消費がさらに改善

## 今後の課題

- Three.js WebGPURenderer が安定版に達した時点で、WebGPU 検出ロジックの再導入と段階的移行を計画する
- syft の ecosystem マッピングを拡充し、Unknown ecosystem のパッケージ割合を減らす。特に Go モジュール（`go.mod`）は purl ではなくファイルパスとして検出されるケースがあり、パーサーの改善余地がある
- oracle にターゲット reconciliation ロジックを追加し、`decree.yaml` から削除されたターゲットを DB から自動的にクリーンアップする仕組みを検討する
- OSV batch API のエラーレスポンスにどのクエリが不正かの情報が含まれないため、不正クエリの特定にはバイナリサーチ的なリトライ戦略も将来的に検討する

## 関連するADR

- ADR-0008: eye WebGL コンテキストリーク修正（WebGL レンダラーの安定性改善、本 ADR の問題A と同じレンダラー層）
- ADR-0009: プロジェクト重複作成・OSV API クエリ形式・空グラフ UX の修正（本 ADR の直接の前提、問題B は ADR-0009 の「今後の課題」を解決）
