package sse

import (
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestToEvent_FindingEvents(t *testing.T) {
	t.Parallel()
	c := &Consumer{group: "test-group", consumerName: "test-consumer"}

	event := c.toEvent("finding-events", redis.XMessage{
		ID:     "1234-0",
		Values: map[string]any{"payload": `{"project_id":"abc","severity":"high"}`},
	})

	if event.Type != "finding_changed" {
		t.Errorf("Type = %q, want finding_changed", event.Type)
	}
	if event.ID != "1234-0" {
		t.Errorf("ID = %q, want 1234-0", event.ID)
	}
	if event.ProjectID != "abc" {
		t.Errorf("ProjectID = %q, want abc", event.ProjectID)
	}
}

func TestToEvent_NotificationEvents(t *testing.T) {
	t.Parallel()
	c := &Consumer{group: "test-group", consumerName: "test-consumer"}

	event := c.toEvent("notification-events", redis.XMessage{
		ID:     "5678-0",
		Values: map[string]any{"payload": `{"project_id":"xyz"}`},
	})

	if event.Type != "notification_sent" {
		t.Errorf("Type = %q, want notification_sent", event.Type)
	}
	if event.ProjectID != "xyz" {
		t.Errorf("ProjectID = %q, want xyz", event.ProjectID)
	}
}

func TestToEvent_UnknownStream(t *testing.T) {
	t.Parallel()
	c := &Consumer{group: "test-group", consumerName: "test-consumer"}

	event := c.toEvent("other-stream", redis.XMessage{
		ID:     "9999-0",
		Values: map[string]any{"payload": `{}`},
	})

	if event.Type != "unknown" {
		t.Errorf("Type = %q, want unknown", event.Type)
	}
}

func TestToEvent_NoPayloadField(t *testing.T) {
	t.Parallel()
	c := &Consumer{group: "test-group", consumerName: "test-consumer"}

	event := c.toEvent("finding-events", redis.XMessage{
		ID:     "1111-0",
		Values: map[string]any{"other": "value"},
	})

	if event.Type != "finding_changed" {
		t.Errorf("Type = %q, want finding_changed", event.Type)
	}
	// When no payload field, it falls back to a JSON with stream and id
	if event.Data != `{"stream":"finding-events","id":"1111-0"}` {
		t.Errorf("Data = %q", event.Data)
	}
}

func TestExtractProjectID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		data string
		want string
	}{
		{"valid", `{"project_id":"abc"}`, "abc"},
		{"missing", `{"other":"field"}`, ""},
		{"invalid_json", `not json`, ""},
		{"empty", `{}`, ""},
		{"empty_string", `{"project_id":""}`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := extractProjectID(tt.data)
			if got != tt.want {
				t.Errorf("extractProjectID(%q) = %q, want %q", tt.data, got, tt.want)
			}
		})
	}
}
