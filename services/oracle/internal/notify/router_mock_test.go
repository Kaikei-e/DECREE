package notify

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"decree/services/oracle/internal/diff"
	"decree/services/oracle/internal/domain"
)

// mockDeliveryStore implements DeliveryStore for testing.
type mockDeliveryStore struct {
	dedupResults map[string]bool
	deliveries   []domain.DeliveryRecord
}

func newMockDeliveryStore() *mockDeliveryStore {
	return &mockDeliveryStore{
		dedupResults: make(map[string]bool),
	}
}

func (m *mockDeliveryStore) CheckDedup(_ context.Context, dedupKey, channel string) (bool, error) {
	return m.dedupResults[dedupKey+":"+channel], nil
}

func (m *mockDeliveryStore) InsertDeliveryLog(_ context.Context, rec domain.DeliveryRecord) error {
	m.deliveries = append(m.deliveries, rec)
	return nil
}

func TestRouter_WithMockStore_DeliveryLogged(t *testing.T) {
	store := newMockDeliveryStore()
	ch := &mockChannel{name: "test"}
	router := NewRouter(store, []ChannelConfig{
		{Channel: ch, Threshold: "low"},
	})

	score := float32(8.0)
	events := []diff.DiffEvent{
		{
			Kind:        diff.DiffNewCVE,
			TargetID:    uuid.New(),
			AdvisoryID:  "CVE-2024-001",
			Severity:    "critical",
			DecreeScore: &score,
		},
	}

	router.Notify(context.Background(), events)

	if len(store.deliveries) != 1 {
		t.Fatalf("deliveries = %d, want 1", len(store.deliveries))
	}
	if store.deliveries[0].Status != "delivered" {
		t.Errorf("status = %q, want delivered", store.deliveries[0].Status)
	}
	if store.deliveries[0].Channel != "test" {
		t.Errorf("channel = %q, want test", store.deliveries[0].Channel)
	}
}

func TestRouter_WithMockStore_Dedup(t *testing.T) {
	store := newMockDeliveryStore()
	ch := &mockChannel{name: "test"}
	router := NewRouter(store, []ChannelConfig{
		{Channel: ch, Threshold: "low"},
	})

	targetID := uuid.New()
	dedupKey := DedupKey(targetID, "CVE-2024-001", "new_cve")
	store.dedupResults[dedupKey+":test"] = true

	events := []diff.DiffEvent{
		{
			Kind:       diff.DiffNewCVE,
			TargetID:   targetID,
			AdvisoryID: "CVE-2024-001",
			Severity:   "critical",
		},
	}

	router.Notify(context.Background(), events)

	if len(ch.sent()) != 0 {
		t.Errorf("sent %d messages, want 0 (should be deduped)", len(ch.sent()))
	}
}

// alwaysFailChannel always fails to send.
type alwaysFailChannel struct {
	name string
}

func (a *alwaysFailChannel) Name() string { return a.name }
func (a *alwaysFailChannel) Send(_ context.Context, _ NotificationMessage) error {
	return &mockSendError{}
}

func TestRouter_WithMockStore_FailedDelivery(t *testing.T) {
	store := newMockDeliveryStore()
	ch := &alwaysFailChannel{name: "test"}
	router := NewRouter(store, []ChannelConfig{
		{Channel: ch, Threshold: "low"},
	})

	score := float32(8.0)
	events := []diff.DiffEvent{
		{
			Kind:        diff.DiffNewCVE,
			TargetID:    uuid.New(),
			AdvisoryID:  "CVE-2024-002",
			Severity:    "critical",
			DecreeScore: &score,
		},
	}

	router.Notify(context.Background(), events)

	if len(store.deliveries) != 1 {
		t.Fatalf("deliveries = %d, want 1", len(store.deliveries))
	}
	if store.deliveries[0].Status != "failed" {
		t.Errorf("status = %q, want failed", store.deliveries[0].Status)
	}
}
