FROM golang:1.26.1-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o decree-gateway .

FROM alpine:3.19

WORKDIR /app
COPY --from=builder /app/decree-gateway .

EXPOSE 8400

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8400/healthz || exit 1

CMD ["./decree-gateway"]
