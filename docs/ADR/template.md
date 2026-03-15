# DECREE ADR テンプレート

このテンプレートはDECREEプロジェクトにおけるADRの標準構成。
実際の `docs/ADR/template.md` が存在する場合はそちらを優先すること。

---

```markdown
# ADR-XXXX: タイトル

## ステータス

Proposed | Accepted | Deprecated | Superseded by ADR-YYYY

## 日付

YYYY-MM-DD

## コンテキスト

この決定が必要になった背景・課題・制約を記述する。

記述の観点:
- 何が問題だったか
- どのような技術的・ビジネス的制約があったか
- 関連するDECREEコンポーネント（scanner / oracle / gateway / eye）
- 脆弱性ドメイン固有の背景（SBOM生成、CVE照合、EPSS、可視化など）

## 決定事項

何を決めたかを明確に記述する。

## 実装の概要

どう実装したかを記述する。アーキテクチャ図、主要コンポーネント、
データフローなどを含める。

記述の観点:
- 関連サービスとその役割
- データモデルの変更（どの層: fact / resource / projection）
- Atlas migration の追加・変更
- API エンドポイントの追加・変更
- Redis Streams のイベント設計
- 可視化への影響（Three.js / Sigma.js）

## 代替案

検討した代替案とその却下理由を記述する。
「なぜ他の方法ではなくこの方法を選んだか」が最も価値のある記録。

## 影響・トレードオフ

### メリット

この決定によって得られる利点。

### デメリット・リスク

この決定に伴うリスクや制約。

### パフォーマンスへの影響

スキャンパイプラインのスループット、メモリ使用量、
可視化のレンダリング性能などへの影響。

## 今後の課題

この決定に関連して将来対応が必要になりうる事項。

## 関連するADR

- ADR-XXXX: 関連する過去の決定
```

---

## セクション別の執筆ガイド

**コンテキスト**: 最も重要なセクション。後から読む人が「なぜ」を理解できるように書く。
技術的な課題だけでなく、チームの状況やプロジェクトのフェーズも含める。

**決定事項**: 簡潔に。1〜3文で核心を述べる。詳細は「実装の概要」に委ねる。

**代替案**: 却下した選択肢を記録しておくことで、同じ議論の繰り返しを防ぐ。
「Xも検討したが、Yの理由で採用しなかった」の形式が読みやすい。

**影響・トレードオフ**: メリットだけでなくデメリットも正直に書く。
将来の自分や他のコントリビューターが判断材料にできるように。

## DECREE 固有の記述パターン

**スキャンパイプライン変更時:**
```
SBOM生成 → OSV/NVD照合 → EPSS付与 → DECREE Score算出 → 分類
```
パイプラインのどのステージに影響するかを明示する。

**可視化変更時:**
WebGPURenderer（Primary）とSigma.js（Fallback）の双方への影響を記述する。
ノード属性（色・サイズ・透明度・パルス）やAttack Surface Shellへの変更は特に明記。

**データモデル変更時:**

DECREEはイミュータブルデータモデルを採用している。変更がどの層に影響するかを明記する:

```
fact table (INSERT ONLY):
  scans / vulnerability_observations / vulnerability_disappearances

resource table:
  projects / targets / vulnerability_instances / advisory_fix_versions

projection table (UPDATE可):
  current_finding_status

graph table:
  dependency_edges
```

- fact table への変更: 観測事実の記録構造に影響する。UPDATE は許可されない設計であることを確認
- resource table への変更: リソースのライフサイクルに影響する
- projection table への変更: UIの応答性や通知ロジックに影響する。fact table からの再構築が可能であることを確認
- 新規テーブル追加: 3層のどこに位置づくかを明記する

Atlas migration の手順:
1. `db/` 配下のスキーマ正本を更新
2. `atlas migrate diff <name>` で migration ファイルを生成
3. `atlas migrate lint` で検証
4. ADRに migration ファイル名と変更内容のサマリーを記載

**リアルタイムモニタリング変更時:**
ポーリング間隔、Redis Streams のイベント設計、SSE エンドポイントへの影響を記述する。
singleflight パターンやcircuit breaker の適用有無も明記。