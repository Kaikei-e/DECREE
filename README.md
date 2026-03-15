# DECREE

**Dynamic Realtime Exploit Classification & Evaluation Engine**

Vulnerability classification, scoring, and 3D visualization platform. Scan is delegated to existing tools (Trivy/Grype/Syft); DECREE differentiates through classification, scoring, and visualization.

## Architecture

```
┌──────────────┐   ┌──────────────┐
│decree-scanner│──▶│ decree-oracle│
│    (Rust)    │   │    (Go)      │
└──────────────┘   └──────┬───────┘
                          │ Redis Streams
                          ▼
┌──────────────┐   ┌──────────────┐
│decree-gateway│◀──│  decree-eye  │
│    (Go)      │   │ (TypeScript) │
└──────────────┘   └──────────────┘

┌──────────────┐   ┌──────────────┐
│ PostgreSQL 17│   │   Redis 7    │
└──────────────┘   └──────────────┘
```

| Service | Lang | Port | Role |
|---|---|---|---|
| decree-scanner | Rust | 9000 (internal) | SBOM generation, OSV/NVD/EPSS matching, DECREE Score |
| decree-oracle | Go | 9100 (internal) | Polling scheduler, diff detection, notifications |
| decree-gateway | Go | 8400 | BFF — REST + SSE |
| decree-eye | TypeScript | 3400 | Three.js WebGPU + Sigma.js fallback |
| PostgreSQL | — | 5434 (host) | Persistent storage |
| Redis | — | 6381 (host) | Streams for real-time pub/sub |

## Quick Start

```bash
git clone https://github.com/Kaikei-e/DECREE.git
cd DECREE

# Set up secrets
echo "decree" > secrets/postgres_password.txt
echo "" > secrets/nvd_api_key.txt          # optional, recommended
echo "" > secrets/slack_webhook_url.txt     # optional
echo "" > secrets/discord_webhook_url.txt   # optional
echo "" > secrets/decree_webhook_token.txt  # optional

# Start all services
docker compose up -d

# Verify
docker compose ps
curl http://localhost:8400/healthz
curl http://localhost:3400/healthz
```

## Per-Service Development

```bash
# Scanner (Rust)
cd services/scanner && cargo build && cargo test

# Oracle (Go)
cd services/oracle && go build ./... && go test ./...

# Gateway (Go)
cd services/gateway && go build ./... && go test ./...

# Eye (TypeScript / SvelteKit)
cd services/eye && pnpm install && pnpm run dev
```

## Makefile Targets

```bash
make up         # docker compose up -d
make down       # docker compose down
make build      # docker compose build
make proto      # buf generate
make migrate    # atlas migrate apply
make lint       # lint all services
make test       # test all services
make fmt        # format all services
```

## DECREE Score

```
DECREE Score = (CVSS_base × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 0.25)
```
