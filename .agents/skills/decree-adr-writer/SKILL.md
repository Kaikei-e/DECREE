---
name: decree-adr-writer
description: |
  Writes Architecture Decision Records (ADRs) for the DECREE project
  (Dynamic Realtime Exploit Classification & Evaluation Engine).
  Rebuilds Docker Compose services, verifies container health, then
  documents the implementation in Japanese following the project's ADR template.
  Triggers on phrases like 「ADRを書いて」「ADRにまとめて」「ADRに記録して」
  「コンテナ再ビルドしてADR書いて」「実装まとめをADRに」「docs/ADR」,
  or any request to document a completed DECREE implementation.
  Also triggers when asked to write an ADR without container operations
  (e.g. 「ADRだけ書いて」). Always use this skill for any ADR-related
  task in the DECREE project, even if the user does not explicitly
  mention "ADR" but asks to document or record an architectural decision.
---

# DECREE ADR Writer

DECREEプロジェクトの実装完了後にコンテナ再ビルド・起動確認を行い、
ADRファイルに日本語で実装内容をまとめるスキル。

## DECREE プロジェクト概要

脆弱性のリアルタイムモニタリングと攻撃面の Three.js/WebGPU 可視化を行うOSS。

**MVPサービス構成:**

| サービス | 言語 | 役割 |
|---|---|---|
| decree-scanner | Rust | SBOM生成・脆弱性照合・EPSSマッチング |
| decree-oracle | Go | スケジューラ・差分検出・通知ディスパッチ |
| decree-gateway | Go | REST/SSE API・BFF |
| decree-eye | TypeScript | Three.js WebGPURenderer + Sigma.js フォールバック |
| decree-migrate | Atlas | DDLマイグレーション（ジョブとして起動時に実行） |

**データストア:** PostgreSQL + Redis Streams

**データモデル（イミュータブル設計）:**
- **fact table** (INSERT ONLY): `scans`, `vulnerability_observations`, `vulnerability_disappearances`
- **resource table**: `targets`, `vulnerability_instances`, `advisory_fix_versions`
- **projection table** (唯一 UPDATE 可): `current_finding_status`

スキーマ管理は Atlas に一本化。`db/` 配下に正本を置き、`atlas migrate diff` で
migration を生成、`decree-migrate` ジョブで適用する。

全サービスはコンパイル言語またはビルドステップを持つため、コード変更後は
`--build` 付きの再ビルドが必須。古いバイナリが動き続けるとADRと実態が乖離する。

## ワークフロー

以下のチェックリストをコピーして進捗を追跡する:

```
ADR作成進捗:
- [ ] Step 1: テンプレートと最新ADR番号を確認
- [ ] Step 2: 関連コンテナを再ビルド・起動
- [ ] Step 3: 起動状態を確認
- [ ] Step 4: ADRを日本語で執筆
- [ ] Step 5: ファイルに書き込み
- [ ] Step 6: 完了報告
```

### Step 1: テンプレートと最新ADR番号を確認

```bash
cat docs/ADR/template.md
ls docs/ADR/ | sort | tail -5
```

ADR番号が会話中で指定されていればそれを使う。未指定なら最新番号の次を採番する。
テンプレートのセクション構成を把握してから執筆に入ること。
テンプレートの詳細な構成例は [references/template.md](references/template.md) を参照。

### Step 2: 関連コンテナを再ビルド・起動

「ADRだけ書いて」と明示された場合はこのステップをスキップする。

実装内容から影響を受けるサービスを特定し、ピンポイントで再ビルドする:

```bash
# 対象サービスのみ
docker compose up --build -d <service1> <service2>

# 全サービスが対象の場合
docker compose up --build -d
```

**スキーマ変更を伴う場合:**
`decree-migrate` が `atlas migrate apply` を実行してから各サービスが起動する
依存関係になっている。スキーマ変更がある場合は migration ファイルが `db/` 配下に
存在することを確認する。migration が未生成なら `atlas migrate diff <name>` で
生成してからビルドに進む。

ビルドが失敗した場合はログを確認してユーザーに報告し、修正を促す。
実装が動いていない状態のADRは信頼性がないため、ビルド成功を確認するまで執筆に進まない。

```bash
# エラー詳細
docker compose logs <service>

# migration 失敗時
docker compose logs decree-migrate
```

### Step 3: 起動確認

```bash
docker compose ps
sleep 5 && docker compose ps
docker compose logs --tail=50 <service>
```

確認ポイント:
- `decree-migrate` が `Exited (0)` で正常終了していること
- 各アプリケーションサービスの `State` が `Up` / `running` であること
- `Exit` / `Restarting` が出ていないこと
- ヘルスチェックがあれば `healthy` であること

異常があればユーザーに報告して止まる。

### Step 4: ADRを日本語で執筆

**執筆ガイドライン:**

1. **テンプレートの構成に従う** — `template.md` のセクション見出しをそのまま使う
2. **日本語で書く** — コード・コマンド・固有名詞（サービス名、ライブラリ名、CVE ID等）は英語のまま
3. **OSSとして公開されるため、機微な情報を含めない:**
   - IPアドレス・ドメイン・ポート番号の具体値（`localhost:8400` 程度はOK）
   - 認証情報・APIキー・シークレット
   - 個人名・組織名
4. **意図・背景・トレードオフを重視する** — 「なぜそう決めたか」が最も重要。コードの羅列ではなく、代替案を検討した上での判断根拠を書く
5. **既存の記載を尊重する** — 既に書かれているセクションは保持・拡充する

**DECREE 固有の記述観点:**

脆弱性ドメインのADRでは以下の観点を意識する:
- DECREE Score（CVSS × EPSS × Reachability の複合スコア）への影響
- スキャンパイプライン（SBOM生成 → OSV/NVD照合 → EPSS付与 → 分類）上の位置づけ
- イミュータブルデータモデル（fact / resource / projection）のどの層に影響するか
- Atlas migration の追加・変更が必要か
- 可視化（WebGPU/Sigma.js フォールバック）との連携
- リアルタイムモニタリング（ポーリング・SSE）への影響

**執筆後のセルフチェック:**
- テンプレートの全セクションが埋まっているか
- 機微な情報が含まれていないか
- DECREE の設計原則と矛盾していないか
- 日本語として自然に読めるか

### Step 5: ファイルに書き込み

```bash
cat > docs/ADR/<対象ファイル>.md << 'DECREE_EOF'
<執筆した内容>
DECREE_EOF

# 書き込み内容を確認
cat docs/ADR/<対象ファイル>.md
```

Gitで管理されているためバックアップは不要。

### Step 6: 完了報告

以下をユーザーに報告する:
1. 再ビルドしたサービス名と起動状態
2. 書き込んだADRファイルのパス
3. ADRの主要セクションのサマリー（3〜5行）
4. `git diff docs/ADR/` で変更差分の表示（オプション）

## 注意事項

- 複数サービスにまたがる実装では、各サービスの役割を明示してADRに記載する
- ADR番号が会話中に明示されていればそれを使い、`ls` で確認しない
- decree-scanner (Rust) と decree-oracle/gateway (Go) で異なる設計判断がある場合は両方の観点を記述する
- 可視化（decree-eye）に関わる変更では、WebGPURenderer とSigma.js フォールバック双方への影響を記載する
- データモデル変更では、fact table への UPDATE 禁止原則を確認し、ADR内で「この変更は fact / resource / projection のどの層に影響するか」を明記する
- スキーマ変更を伴う実装では、Atlas migration ファイルの存在確認をビルド前に行う