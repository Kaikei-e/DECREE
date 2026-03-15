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

# Install Syft
RUN curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

COPY --from=builder /app/services/scanner/target/release/decree-scanner /usr/local/bin/decree-scanner
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:9000/healthz || exit 1
CMD ["decree-scanner"]
