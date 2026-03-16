# AGENTS.md

## What is DECREE

Vulnerability classification, scoring, and 3D visualization platform. Scan is delegated to existing tools (Trivy/Grype/Syft); DECREE differentiates through DECREE Score, immutable event history, and WebGPU spatial visualization.

## Project Map

```
services/
  scanner/    — Rust  (SBOM gen, OSV/NVD/EPSS matching, DECREE Score)
  oracle/     — Go    (polling scheduler, diff detection, notifications)
  gateway/    — Go    (BFF: REST + SSE, subscribes Redis Streams)
  eye/        — SvelteKit + TypeScript (Three.js WebGPU + Sigma.js fallback)
db/           — Atlas schema source + migrations (DDL single source of truth)
decree.yaml   — project targets config
```

## DECREE Score (core invariant — never change this formula without an ADR)

```
DECREE Score = (CVSS_base × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 0.25)
```

## Data Model (immutable design — understand before touching any table)

- **fact tables** (INSERT ONLY, never UPDATE): `scans`, `vulnerability_observations`, `vulnerability_disappearances`
- **resource tables**: `projects`, `targets`, `vulnerability_instances`, `advisory_fix_versions`
- **projection table** (only table allowing UPDATE): `current_finding_status`

Schema changes go through Atlas: edit `db/` sources → `atlas migrate diff <name>` → `atlas migrate lint` → commit migration file.

## Verification (run after every change)

```bash
# Per-service — run the relevant ones, not all
cd services/scanner && cargo test
cd services/oracle  && go test ./...
cd services/gateway && go test ./...
cd services/eye     && pnpm test

# Linting (these catch style issues — don't rely on memory for style rules)
cd services/scanner && cargo clippy -- -D warnings
cd services/oracle  && go vet ./...
cd services/gateway && go vet ./...
cd services/eye     && pnpm run lint

# Type check
cd services/eye     && pnpm run check

# Full stack integration
docker compose up -d && docker compose ps
```

## TDD Workflow

Write tests first, then implement. This is non-negotiable for DECREE.

1. **Red** — Write a failing test that describes the expected behavior
2. **Green** — Write the minimum code to make it pass
3. **Refactor** — Clean up while keeping tests green
4. **Verify** — Run the relevant test command above before moving on

When implementing a new feature:
- Start by writing test cases that capture the requirement
- For scanner (Rust): write tests in the same file with `#[cfg(test)]` module
- For oracle/gateway (Go): write `_test.go` files in the same package
- For eye (SvelteKit): colocate `.test.ts` files next to components
- Run the single test first (`cargo test <name>`, `go test -run <Name>`, `pnpm test <file>`), not the full suite

## Build & Run

```bash
docker compose up -d              # full stack (decree-migrate runs first via depends_on)
docker compose up --build -d      # after code changes — IMPORTANT for compiled languages

# Individual service dev
cd services/scanner && cargo build
cd services/oracle  && go build ./...
cd services/gateway && go build ./...
cd services/eye     && pnpm install && pnpm run dev
```

## Ports

`3400` eye · `8400` gateway · `5434` PostgreSQL · `6381` Redis — chosen to avoid conflicts with Alt (8080 range).

## Configuration

Copy `.env.example` → `.env`. Key vars: `NVD_API_KEY` (recommended), `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `DECREE_WEBHOOK_TOKEN`.
Project targets defined in `decree.yaml` at repo root.

## Gotchas

- DB schema is Atlas-managed under `db/` — never hand-edit `init.sql`; use `atlas migrate diff`
- fact tables are INSERT ONLY — if you need to "update" a vulnerability status, insert into `vulnerability_disappearances`, then rebuild the projection
- Redis Streams consumer groups are created by init scripts on `docker compose up`
- WebGPU needs HTTPS or localhost — don't test eye over plain HTTP on non-localhost
- scanner ↔ oracle communication: gRPC / Connect-RPC (not REST)
- eye package manager is pnpm, not npm or yarn

## When Compacting

Preserve: modified file list, test commands run and their results, current task goal, any ADR numbers mentioned.