package notify

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"

	"decree/services/oracle/internal/diff"
)

// mockChannel records sent messages for testing.
type mockChannel struct {
	name     string
	mu       sync.Mutex
	messages []NotificationMessage
	failNext bool
}

func (m *mockChannel) Name() string { return m.name }

func (m *mockChannel) Send(_ context.Context, msg NotificationMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failNext {
		m.failNext = false
		return &mockSendError{}
	}
	m.messages = append(m.messages, msg)
	return nil
}

func (m *mockChannel) sent() []NotificationMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.messages
}

type mockSendError struct{}

func (e *mockSendError) Error() string { return "mock send error" }

func TestRouter_SeverityFilter(t *testing.T) {
	ch := &mockChannel{name: "test"}
	router := NewRouter(nil, []ChannelConfig{
		{Channel: ch, Threshold: "high"},
	})

	score := float32(5.0)
	events := []diff.DiffEvent{
		{
			Kind:       diff.DiffNewCVE,
			TargetID:   uuid.New(),
			AdvisoryID: "CVE-LOW",
			Severity:   "medium",
			DecreeScore: &score,
		},
		{
			Kind:       diff.DiffNewCVE,
			TargetID:   uuid.New(),
			AdvisoryID: "CVE-HIGH",
			Severity:   "high",
			DecreeScore: &score,
		},
		{
			Kind:       diff.DiffNewCVE,
			TargetID:   uuid.New(),
			AdvisoryID: "CVE-CRIT",
			Severity:   "critical",
			DecreeScore: &score,
		},
	}

	router.Notify(context.Background(), events)

	sent := ch.sent()
	if len(sent) != 2 {
		t.Fatalf("sent %d messages, want 2 (high + critical)", len(sent))
	}

	// Check that medium was filtered out
	for _, msg := range sent {
		if msg.Severity == "medium" {
			t.Error("medium severity should have been filtered")
		}
	}
}

func TestRouter_ToMessage(t *testing.T) {
	score := float32(8.5)
	epss := float32(0.95)
	evt := diff.DiffEvent{
		Kind:           diff.DiffNewCVE,
		TargetName:     "example-api",
		AdvisoryID:     "CVE-2024-001",
		PackageName:    "lodash",
		PackageVersion: "4.17.20",
		Ecosystem:      "npm",
		Severity:       "high",
		DecreeScore:    &score,
		EPSSScore:      &epss,
		HasExploit:     true,
		FixVersions:    []string{"4.17.21"},
	}

	msg := toMessage(evt)

	if msg.TargetName != "example-api" {
		t.Errorf("target = %q", msg.TargetName)
	}
	if msg.DiffKind != "new_cve" {
		t.Errorf("kind = %q", msg.DiffKind)
	}
	if !msg.HasExploit {
		t.Error("should have exploit")
	}
	if len(msg.FixVersions) != 1 || msg.FixVersions[0] != "4.17.21" {
		t.Errorf("fix versions = %v", msg.FixVersions)
	}
}

func TestRouter_EmptyChannels(t *testing.T) {
	router := NewRouter(nil, nil)
	// Should not panic with no channels
	router.Notify(context.Background(), []diff.DiffEvent{
		{Kind: diff.DiffNewCVE, Severity: "critical"},
	})
}
