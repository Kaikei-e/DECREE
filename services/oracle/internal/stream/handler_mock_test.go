package stream

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"decree/services/oracle/internal/diff"
)

// mockDiffDetector implements DiffDetector for testing.
type mockDiffDetector struct {
	events    []diff.DiffEvent
	detectErr error
	called    bool
}

func (m *mockDiffDetector) Detect(_ context.Context, _, _ uuid.UUID) ([]diff.DiffEvent, error) {
	m.called = true
	return m.events, m.detectErr
}

// mockNotifier implements Notifier for testing.
type mockNotifier struct {
	notified []diff.DiffEvent
	called   bool
}

func (m *mockNotifier) Notify(_ context.Context, events []diff.DiffEvent) {
	m.called = true
	m.notified = append(m.notified, events...)
}

func TestHandleScanCompleted_WithMocks(t *testing.T) {
	score := float32(8.0)
	detector := &mockDiffDetector{
		events: []diff.DiffEvent{
			{
				Kind:        diff.DiffNewCVE,
				AdvisoryID:  "CVE-2024-001",
				Severity:    "high",
				DecreeScore: &score,
			},
		},
	}
	notifier := &mockNotifier{}

	router := NewEventRouter(detector, notifier)

	scanID := uuid.New()
	targetID := uuid.New()

	payload, _ := json.Marshal(ScanEvent{
		Type:          "scan.completed",
		ScanID:        scanID.String(),
		TargetID:      targetID.String(),
		FindingsCount: 5,
	})

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"payload": string(payload)},
	}

	err := router.Handle(context.Background(), "scan-events", msg)
	if err != nil {
		t.Fatalf("Handle() error: %v", err)
	}

	if !detector.called {
		t.Error("DiffDetector.Detect was not called")
	}
	if !notifier.called {
		t.Error("Notifier.Notify was not called")
	}
	if len(notifier.notified) != 1 {
		t.Errorf("notified %d events, want 1", len(notifier.notified))
	}
}

func TestHandleScanCompleted_NoEvents(t *testing.T) {
	detector := &mockDiffDetector{events: nil}
	notifier := &mockNotifier{}

	router := NewEventRouter(detector, notifier)

	payload, _ := json.Marshal(ScanEvent{
		Type:     "scan.completed",
		ScanID:   uuid.New().String(),
		TargetID: uuid.New().String(),
	})

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"payload": string(payload)},
	}

	err := router.Handle(context.Background(), "scan-events", msg)
	if err != nil {
		t.Fatalf("Handle() error: %v", err)
	}

	if !detector.called {
		t.Error("DiffDetector.Detect was not called")
	}
	if notifier.called {
		t.Error("Notifier.Notify should not be called with zero events")
	}
}

func TestHandleScanCompleted_DetectError(t *testing.T) {
	detector := &mockDiffDetector{
		detectErr: context.DeadlineExceeded,
	}
	notifier := &mockNotifier{}

	router := NewEventRouter(detector, notifier)

	payload, _ := json.Marshal(ScanEvent{
		Type:     "scan.completed",
		ScanID:   uuid.New().String(),
		TargetID: uuid.New().String(),
	})

	msg := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"payload": string(payload)},
	}

	err := router.Handle(context.Background(), "scan-events", msg)
	if err == nil {
		t.Fatal("expected error from Detect failure")
	}
}
