#!/bin/sh
set -e

REDIS_URL="${REDIS_URL:-redis://redis:6379}"
REDIS_HOST=$(echo "$REDIS_URL" | sed 's|redis://||' | cut -d: -f1)
REDIS_PORT=$(echo "$REDIS_URL" | sed 's|redis://||' | cut -d: -f2)

echo "Waiting for Redis at ${REDIS_HOST}:${REDIS_PORT}..."
until redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping | grep -q PONG; do
  sleep 1
done

echo "Creating consumer groups..."

# Create streams and consumer groups
for STREAM in scan-events finding-events notification-events; do
  redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" XGROUP CREATE "$STREAM" decree-group 0 MKSTREAM 2>/dev/null || \
    echo "Group already exists for $STREAM"
done

# Oracle diff consumer group on scan-events
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" XGROUP CREATE scan-events oracle-diff 0 MKSTREAM 2>/dev/null || \
  echo "Group oracle-diff already exists for scan-events"

# Gateway SSE consumer group on finding-events and notification-events
for STREAM in finding-events notification-events; do
  redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" XGROUP CREATE "$STREAM" gateway-sse 0 MKSTREAM 2>/dev/null || \
    echo "Group gateway-sse already exists for $STREAM"
done

echo "Redis initialization complete."
