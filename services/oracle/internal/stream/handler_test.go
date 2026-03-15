package stream

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestEventRouter_HandleScanFailed_LogsOnly(t *testing.T) {
	router := NewEventRouter(nil, nil)

	payload, _ := json.Marshal(ScanEvent{
		Type:     "scan.failed",
		ScanID:   "00000000-0000-0000-0000-000000000001",
		TargetID: "00000000-0000-0000-0000-000000000002",
		Error:    "target not accessible",
	})

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"payload": string(payload)},
	}

	err := router.Handle(context.Background(), "scan-events", msg)
	if err != nil {
		t.Fatalf("scan.failed should not return error: %v", err)
	}
}

func TestEventRouter_HandleUnknownStream(t *testing.T) {
	router := NewEventRouter(nil, nil)

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"payload": `{}`},
	}

	err := router.Handle(context.Background(), "unknown-stream", msg)
	if err != nil {
		t.Fatalf("unknown stream should not error: %v", err)
	}
}

func TestEventRouter_HandleMissingPayload(t *testing.T) {
	router := NewEventRouter(nil, nil)

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{},
	}

	err := router.Handle(context.Background(), "scan-events", msg)
	if err == nil {
		t.Fatal("expected error for missing payload")
	}
}

func TestEventRouter_HandleUnknownEventType(t *testing.T) {
	router := NewEventRouter(nil, nil)

	payload, _ := json.Marshal(ScanEvent{
		Type: "scan.unknown",
	})

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"payload": string(payload)},
	}

	err := router.Handle(context.Background(), "scan-events", msg)
	if err != nil {
		t.Fatalf("unknown event type should not error: %v", err)
	}
}
