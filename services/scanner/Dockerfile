# Stage 1: Build
FROM rust:1.94.0-bookworm AS chef
RUN apt-get update && apt-get install -y pkg-config libssl-dev protobuf-compiler && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef --locked
WORKDIR /app/services/scanner

FROM chef AS planner
COPY services/scanner/Cargo.toml services/scanner/Cargo.lock ./
COPY services/scanner/src ./src
COPY services/scanner/build.rs ./
COPY proto /app/proto
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/services/scanner/recipe.json recipe.json
COPY proto /app/proto
COPY services/scanner/build.rs ./
RUN cargo chef cook --release --recipe-path recipe.json
COPY services/scanner/Cargo.toml services/scanner/Cargo.lock ./
COPY services/scanner/src ./src
COPY services/scanner/build.rs ./
RUN cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies: ca-certificates, wget (healthcheck), git, curl, syft
RUN apt-get update && apt-get install -y ca-certificates wget git curl && rm -rf /var/lib/apt/lists/*

# Install Syft from a pinned release tarball verified against a hardcoded SHA-256.
# SBOM output — and therefore scan results — is only reproducible if the syft version is fixed.
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

COPY --from=builder /app/services/scanner/target/release/decree-scanner /usr/local/bin/decree-scanner
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:9000/healthz || exit 1
CMD ["decree-scanner"]
