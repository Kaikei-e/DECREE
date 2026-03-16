# ADR-0011: CVSS ベクトルパース修正とカメラ配置・操作性改善

## ステータス

Accepted

## 日付

2026-03-16

## コンテキスト

decree-eye の 3D 可視化で以下の症状が確認された:

1. **全ノードが左下隅に緑色の塊として表示される** — 45 件の脆弱性がすべて INFO (緑) の小さなクラスターに固まり、severity による色分けや Y 軸方向のスコア分布が機能していない
2. **カーソルを近づけるとカメラがドリフトしてノードをクリックできない** — OrbitControls の慣性が長時間続き、ユーザー操作を阻害

### 根本原因の連鎖

OSV API は CVSS スコアを数値文字列 (`"7.5"`) ではなくベクトル文字列 (`"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"`) で返すケースがある。decree-scanner の `extract_cvss_score()` は `parse::<f32>()` のみで処理していたため、ベクトル文字列では `None` を返していた。

この `None` が以下のように連鎖的に影響した:

```
extract_cvss_score() → None
  → decree_score(None, ...) → None
  → severity_label(None) → "unknown"
  → DB: last_score=NULL, last_severity='unknown' (全件)
  → Frontend: decree_score=0 → Y位置=0, severity=INFO → 緑色
  → 全ノードが (0±jitter, 0, 0±jitter) に配置
```

加えて、`overviewPreset` のカメラ lookAt が `y=15` と高い位置を見ていたため、`y≈0` に集まったノード群はビューポートの下端に小さく映るだけだった。

カメラの操作性問題は `dampingFactor=0.05` に起因する。この値は Three.js のデフォルトだが、脆弱性ノードをクリックして詳細を開くという DECREE の操作パターンには減衰が遅すぎた。

## 決定事項

1. `cvss` crate (v2) を導入し、CVSS v3.0/v3.1 ベクトル文字列から正確なベーススコアを算出する
2. カメラの初期位置・注視点をノードの実際のバウンディングボックスに基づいて計算する
3. OrbitControls の減衰係数を引き上げ、ズーム範囲を制限する

## 実装の概要

### decree-scanner (Rust): CVSS ベクトルパース

**影響するパイプラインステージ:** OSV/NVD 照合 → DECREE Score 算出

`services/scanner/src/osv/types.rs` の `extract_cvss_score()` を拡張:

```rust
// 1. 数値文字列 ("7.5") → そのまま parse
if let Ok(score) = sev.score.parse::<f32>() {
    return Some(score);
}
// 2. ベクトル文字列 ("CVSS:3.1/AV:N/...") → cvss crate でパース
if sev.score.starts_with("CVSS:3") {
    if let Ok(base) = sev.score.parse::<cvss::v3::Base>() {
        return Some(base.score().value() as f32);
    }
}
```

`cvss` crate は FIRST.org の CVSS v3.0/v3.1 仕様に準拠したスコア算出を行う。独自実装ではなく標準準拠のライブラリを使うことで、スコア計算の正確性を担保する。

**テスト追加:**
- ベクトル文字列 `"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"` → 9.8
- v3.0 ベクトル → 同様にパース成功
- 数値文字列 `"7.5"` → 7.5（既存動作の回帰テスト）
- 不正文字列 → `None`
- severity 配列が空 → `None`

### decree-eye (TypeScript): カメラ配置修正

**影響するコンポーネント:** Three.js WebGLRenderer（Primary レンダラー）

#### overviewPreset の修正

`services/eye/src/lib/renderer/three/camera-presets.ts`:

| パラメータ | 変更前 | 変更後 | 理由 |
|---|---|---|---|
| `position.x` | `span / 2` | `centerX = (clusterCount-1)*8/2` | 1 クラスター時に `x=0`（ノード群の真上） |
| `position.y` | `30` | `15` | ノードに近づけて視認性を向上 |
| `lookAt.y` | `15` | `3` | decree_score が低い（`y≈0`）場合でもノードが画面中央に来る |

#### resetView のバウンディングボックス対応

`services/eye/src/lib/renderer/three/ThreeSceneRenderer.ts` の `resetView()` を改修。ノードが存在する場合は全ノードの X/Y 範囲からバウンディングボックスを計算し、カメラを自動的にフレーミングする。ノードが存在しない場合のみ `overviewPreset` にフォールバックする。

```
spread = max(maxX - minX, maxY - minY, 10)
position = (cx, cy + spread×0.8, spread×1.5)
lookAt   = (cx, cy, 0)
```

#### OrbitControls 操作性改善

| パラメータ | 変更前 | 変更後 | 理由 |
|---|---|---|---|
| `dampingFactor` | `0.05` | `0.15` | カメラドリフトを 3 倍速く減衰させ、クリック操作を容易にする |
| `rotateSpeed` | デフォルト (1.0) | `0.5` | 回転感度を下げて誤操作を軽減 |
| `minDistance` | なし | `3` | ズームインしすぎてノードの中に入ることを防止 |
| `maxDistance` | なし | `200` | 極端なズームアウトを防止 |

### データモデルへの影響

データモデル自体の変更はない。`current_finding_status.last_score` と `current_finding_status.last_severity` に正しい値が入るようになる（projection table の既存カラムへの値の変化のみ）。Atlas migration の追加は不要。

## 代替案

### 代替案 1: CVSS ベクトルの正規表現パース

`cvss` crate を使わず、ベクトル文字列を正規表現で分解して各メトリクスの値を取り出し、CVSS v3 の公式に従って自力でスコアを計算する方法。

**却下理由:** CVSS v3 のスコア計算は Scope 変更時の影響係数など複雑なロジックを含む。自前実装は計算誤差やエッジケースのリスクがあり、FIRST.org 仕様準拠の `cvss` crate に委ねるのが合理的。crate のサイズも小さく（pure Rust, 依存なし）、ビルド時間への影響は軽微。

### 代替案 2: NVD API からスコアを取得

OSV のベクトル文字列をパースする代わりに、CVE ID で NVD API を叩いて数値スコアを取得する方法。

**却下理由:** NVD API には Rate Limit があり、API キーなしでは 5 req/30s に制限される。全脆弱性について追加の API コールを発行するとスキャン時間が大幅に増加する。OSV が返すベクトル文字列をローカルでパースする方が高速かつ信頼性が高い。

### 代替案 3: カメラの自動フィット（frustum 計算）

バウンディングボックスからカメラの frustum を正確に計算し、全ノードがぴったり収まるようにする方法。

**却下理由:** PerspectiveCamera の frustum 計算はアスペクト比や FOV を考慮する必要があり複雑になる。現状のヒューリスティック（`spread × 0.8` / `spread × 1.5`）で十分な視認性が得られるため、過剰な精度は不要と判断した。

## 影響・トレードオフ

### メリット

- OSV API が返す CVSS ベクトル文字列から正確なスコアが得られるようになり、DECREE Score が正しく算出される
- 可視化でノードが severity に応じた色分け（赤=CRITICAL, 橙=HIGH, 黄=MEDIUM, 青=LOW）と Y 軸方向の分布を示すようになる
- カメラが自動的にノード群を画面中央にフレーミングし、操作時のドリフトも速やかに収束する

### デメリット・リスク

- `cvss` crate (v2) への新規依存が追加される。ただし pure Rust で外部依存はないため、サプライチェーンリスクは低い
- 既存の `last_score=NULL` のデータは再スキャンするまで修正されない。再スキャンにより新たな `vulnerability_observations` が INSERT され、`current_finding_status` の projection が更新される

### パフォーマンスへの影響

- **スキャンパイプライン:** CVSS ベクトルのパースは CPU のみの処理で、1 件あたりマイクロ秒オーダー。スキャン全体のスループットへの影響はない
- **可視化レンダリング:** `resetView()` のバウンディングボックス計算はノード数に線形（O(n)）。数千ノードでも問題にならない

## 今後の課題

- CVSS v4.0 ベクトル文字列への対応（`cvss` crate v2 は v3.x のみサポート）
- Sigma.js フォールバックレンダラーでも同様のカメラ/ビューポート調整が必要か検討
- ノードホバー時に OrbitControls を一時的に無効化する仕組みの導入（イベント競合の根本解決）

## 関連する ADR

- ADR-0008: Eye WebGL コンテキストリーク修正（リソース管理の改善）
- ADR-0009: 重複プロジェクト・OSV クエリ・空可視化の修正
- ADR-0010: WebGPU プローブ除去・OSV エコシステムフィルタ
