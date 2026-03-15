.PHONY: up down build proto migrate lint test fmt

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

proto:
	buf generate

migrate:
	atlas migrate apply --env docker

migrate-diff:
	atlas migrate diff $(name) --env docker

lint:
	buf lint
	cd services/scanner && cargo clippy -- -D warnings
	cd services/oracle && go vet ./...
	cd services/gateway && go vet ./...
	cd services/eye && pnpm run lint

test:
	cd services/scanner && cargo test
	cd services/oracle && go test ./...
	cd services/gateway && go test ./...
	cd services/eye && pnpm test

fmt:
	cd services/scanner && cargo fmt
	cd services/oracle && gofmt -w .
	cd services/gateway && gofmt -w .
	cd services/eye && pnpm run format

fmt-check:
	cd services/scanner && cargo fmt --check
	cd services/oracle && gofmt -l . | grep -q . && exit 1 || true
	cd services/gateway && gofmt -l . | grep -q . && exit 1 || true
