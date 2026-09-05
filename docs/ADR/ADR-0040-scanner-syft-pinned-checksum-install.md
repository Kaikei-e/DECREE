# ADR-0040: scanner イメージにおける Syft のバージョン固定とチェックサム検証

## ステータス

Accepted

## 日付

2026-09-05

## コンテキスト

DECREE scanner の runtime ステージは、SBOM 生成に使う Syft を次の一行でインストールしていた。

```dockerfile
RUN curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
```

これは「移動し続けるブランチ（`main`）から取得したスクリプトを、検証せずそのままシェルへパイプする」構造であり、二つの問題を同時に抱えていた。

**1. ビルドが再現不能である。** バージョン引数がないため、`install.sh` はその時点の latest release を取得する。同一コミットからビルドしても時期が違えば別バージョンの Syft が入る。Syft は SBOM 生成器であり、`services/scanner/src/adapter/git.rs` および `container.rs` が `syft <target> -o cyclonedx-json --quiet` として呼び出している。SBOM の内容が変われば下流の OSV 照合結果、ひいては DECREE Score と分類結果まで変わりうる。つまりスキャンパイプラインの入力段が非決定的だった。

```
SBOM生成 ← ★ここが非決定的だった
  → OSV/NVD照合 → EPSS付与 → DECREE Score算出 → 分類
```

**2. ビルド時任意コード実行の経路になっている。** 上流リポジトリの侵害、あるいは配送経路（raw.githubusercontent.com、CDN、DNS）の侵害があれば、任意のスクリプトがビルド時に実行され、その成果物が出荷イメージに入る。DECREE 自身が脆弱性スキャン製品である以上、自らのサプライチェーンは製品のセキュリティ主張の一部であり、この状態は自己矛盾していた。

なお `install.sh` 自体は取得したリリース資産のチェックサム照合を行うが、**その `install.sh` を誰も検証していない**ため、防御としては成立していない。信頼の起点がビルドのたびにネットワーク越しに取得される可変コンテンツになっていた。

## 決定事項

Syft のインストールを、**バージョンを固定したリリース tarball の直接ダウンロード＋Dockerfile 内にハードコードした SHA-256 との照合**に置き換える。リモートスクリプトの実行は完全に廃止する。固定バージョンは、置き換え前のイメージに実際に入っていた **1.51.1** とする（挙動の変化を持ち込まないため）。

## 実装の概要

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `services/scanner/Dockerfile` | runtime ステージの Syft インストール手順を差し替え |

Rust コード、データモデル（fact / resource / projection）、Atlas migration、API、可視化のいずれにも変更はない。バイナリの設置先 `/usr/local/bin/syft` と PATH 解決も従来どおりで、`Command::new("syft")` の呼び出し側は無改修である。

### インストール手順

```dockerfile
ARG SYFT_VERSION=1.51.1
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) syft_sha256=8fcb33017a0dc1058298c923c436d19dfa68ae93968e0b423248542e3afb9fc3 ;; \
      arm64) syft_sha256=a7fd2b784e6664acd44719270574f6cd8c6864fc2b1700bf9099bd1cccda7d7f ;; \
      *) echo "unsupported TARGETARCH: '${TARGETARCH}' (BuildKit required)" >&2; exit 1 ;; \
    esac; \
    tarball="syft_${SYFT_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    curl -sSfL -o "/tmp/${tarball}" \
      "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/${tarball}"; \
    echo "${syft_sha256}  /tmp/${tarball}" | sha256sum -c -; \
    tar -xzf "/tmp/${tarball}" -C /usr/local/bin syft; \
    rm "/tmp/${tarball}"; \
    syft --version
```

設計上の要点は四つ。

- **信頼の起点が Dockerfile 内にある。** 期待値の SHA-256 はソース管理下のリテラルであり、ビルド時にネットワークから取得されない。tarball が差し替えられれば `sha256sum -c` が失敗し、ビルドが止まる。
- **`set -eux` と `sha256sum -c -` の組み合わせで fail-closed。** 検証失敗時に後続の `tar` へ進まない。
- **`TARGETARCH`（BuildKit が自動供給）で amd64 / arm64 双方の SHA-256 を持つ。** 未知アーキテクチャは黙って通さず明示的に失敗させる。既定値を与えていないのは、BuildKit 非経由でアーキテクチャが不明なまま amd64 を仮定するより、理由の分かるエラーで落ちるほうが安全なため。
- **末尾の `syft --version` がスモークテストを兼ねる。** 展開したバイナリが実行可能でなければイメージが焼き上がらない。

### 検証

固定値は上流の `syft_1.51.1_checksums.txt`（GitHub Releases 上の公開チェックサム一覧）から転記した。

- 正常系: `docker compose build decree-scanner` が成功し、`docker run --rm --entrypoint syft <image> --version` が `syft 1.51.1` を返す。`command -v syft` は `/usr/local/bin/syft`。
- 機能確認: Rust 側と同一引数（`-o cyclonedx-json --quiet`）で `services/scanner` を走査し、CycloneDX 1.7 JSON が生成されること、`metadata.tools` に `syft 1.51.1` が記録されることを確認。
- 異常系: `--build-arg SYFT_VERSION=1.51.0` でビルドすると、ハードコードした 1.51.1 の SHA-256 と一致せず `sha256sum: WARNING: 1 computed checksum did NOT match` でビルドが失敗する。検証が実際に機能していることの証明。

## 代替案

### 代替案 1: `install.sh` にバージョン引数を渡すだけ（`| sh -s -- -b /usr/local/bin v1.51.1`）

差分が最小で済む。しかし再現性しか解決しない。スクリプト本体は依然として `main` ブランチから無検証で取得・実行されるため、ビルド時任意コード実行の経路は残ったままになる。二つある問題のうち片方しか閉じないため却下した。

### 代替案 2: スクリプト URL をタグに固定する（`.../anchore/syft/v1.51.1/install.sh`）

タグ URL にすれば内容は事実上不変になり、代替案 1 より改善する。ただし Git タグは上流で付け替えが可能であり、スクリプト自体のチェックサム検証は依然として存在しない。信頼の起点がリモートに残る点は変わらないため、採用しなかった。

### 代替案 3: `COPY --from=anchore/syft:v1.51.1` による multi-stage コピー

公式イメージが存在するため技術的には可能で、記述はもっとも簡潔になる。却下理由は二つ。第一に、イメージタグはダイジェスト固定しない限り可変であり、`@sha256:...` まで書くなら結局ハードコードした digest を管理することになって現行案と手間が変わらない。第二に、ビルド時に数十 MB のベースイメージ取得が追加で発生し、また Syft バイナリの取得元が「公開チェックサム一覧で照合可能な GitHub リリース資産」から「レジストリ上のイメージ」へ移る。監査のしやすさで劣ると判断した。

### 代替案 4: Syft バイナリを Git リポジトリにベンダリングする

ネットワーク依存を完全に排除できるが、87 MB のバイナリをリポジトリに入れることになり現実的でない。

## 影響・トレードオフ

### メリット

- ビルド時のリモートスクリプト実行が消え、上流リポジトリ侵害・配送経路侵害からビルドを保護できる。信頼の起点が Dockerfile 内のリテラルに移った
- 同一コミットからのビルドが常に同一バージョンの Syft を含む。SBOM 生成が決定的になり、スキャン結果の差分が「対象の変化」に由来すると言い切れるようになった
- 固定先を既存イメージと同じ 1.51.1 にしたため、この変更自体による挙動変化はない
- バージョンと期待チェックサムがコードレビューの対象になる。Syft の更新が差分として可視化される

### デメリット・リスク

- **Syft 自身のセキュリティ修正が自動では入らなくなる。** これが本 ADR 最大のトレードオフである。従来は（望まぬ形とはいえ）ビルドのたびに latest を拾っていた。今後はバージョン更新が明示的な作業になる。運用としては、`ARG SYFT_VERSION` と対応する 2 つの `syft_sha256` を上流の `syft_<version>_checksums.txt` から転記して更新する PR を切る。手順は「上流リリースノートを確認 → チェックサム一覧から amd64/arm64 の値を転記 → ビルドして `syft --version` を確認 → SBOM 出力の差分を確認」。四半期ごと、および Syft に CVE が出た時点での更新を想定する
- 上流のリリース資産更新（再アップロード等）があるとチェックサム不一致でビルドが落ちる。ただしこれは検出であって障害ではなく、意図した挙動である
- **チェックサム値の初期取得は TOFU（trust on first use）である。** 上流の公開チェックサム一覧を HTTPS 経由で一度取得し、それを転記して固定した。Anchore が提供する cosign 署名／SLSA provenance の検証まではこの ADR では行っていない。ここで得たのは「pin 以降の改竄検出」であって「pin 時点の真正性の暗号学的証明」ではない
- `TARGETARCH` に依存するため BuildKit（現行の `docker compose build` の既定）が前提になる。legacy builder ではアーキテクチャが解決できず明示的に失敗する

### パフォーマンスへの影響

ビルド時間はほぼ不変（スクリプト経由でも同じ tarball を取得していたため）。`sha256sum` の実行は 87 MB に対して 1 秒未満。ランタイム性能・スキャンスループットへの影響はない。

## 今後の課題

- **cosign / SLSA provenance の検証**: Anchore は Syft リリースに対して cosign 署名と provenance を公開している。ビルドステージで `cosign verify-blob` を実行すれば、TOFU を脱して真正性を検証できる。ビルドイメージに cosign を（同じくチェックサム固定で）入れるコストとの兼ね合いで判断する
- **バージョン更新の自動化**: Dependabot の Docker ecosystem は `FROM` のみを追跡し、`ARG` で表現したツールバージョンは対象外である。本リポジトリには `.github/dependabot.yml` が存在しない。Renovate の `regexManagers` であれば `ARG SYFT_VERSION` と SHA-256 を同時に更新できるため、導入を検討する
- **ベースイメージのダイジェスト固定**: 全サービスの Dockerfile が `debian:bookworm-slim` / `node:24-alpine` / `alpine:3.24` といった可変タグを参照している。本 ADR と同じ論理がベースイメージにも当てはまるため、`@sha256:` 固定を別途検討する
- **Trivy / Grype の導入時**: 現時点でこれらはドキュメント上の言及のみで、リポジトリ内のどこにもインストールされていない。将来導入する際は最初から本 ADR と同じ方式（バージョン固定＋チェックサム検証）を適用する

## 関連するADR

- ADR-0031: OSV affected range のクライアントサイド検証 — 外部データソースを無検証で信頼しないという同じ原則を、スキャン結果ではなくビルド成果物に適用したもの
