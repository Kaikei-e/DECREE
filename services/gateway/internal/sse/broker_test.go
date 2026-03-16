package sse

import (
	"testing"
	"time"
)

func TestBroker_RegisterUnregister(t *testing.T) {
	b := NewBroker()

	id, ch, err := b.Register("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ch == nil {
		t.Fatal("expected non-nil channel")
	}
	if b.ClientCount() != 1 {
		t.Fatalf("client count = %d, want 1", b.ClientCount())
	}

	b.Unregister(id)
	if b.ClientCount() != 0 {
		t.Fatalf("client count = %d, want 0", b.ClientCount())
	}

	// Channel should be closed
	_, ok := <-ch
	if ok {
		t.Error("expected channel to be closed")
	}
}

func TestBroker_Broadcast(t *testing.T) {
	b := NewBroker()
	_, ch1, _ := b.Register("")
	_, ch2, _ := b.Register("")

	event := Event{ID: "1-0", Type: "finding_changed", Data: `{"test":true}`}
	b.Broadcast(event)

	select {
	case e := <-ch1:
		if e.Type != "finding_changed" {
			t.Errorf("type = %q", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for event on ch1")
	}

	select {
	case e := <-ch2:
		if e.ID != "1-0" {
			t.Errorf("id = %q", e.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for event on ch2")
	}
}

func TestBroker_DropOnFullBuffer(t *testing.T) {
	b := NewBroker()
	_, ch, _ := b.Register("")

	// Fill the buffer
	for i := range clientBufferSize {
		b.Broadcast(Event{ID: string(rune(i)), Type: "test", Data: "{}"})
	}

	// This should be dropped, not block
	b.Broadcast(Event{Type: "dropped", Data: "{}"})

	// Drain and verify we got exactly clientBufferSize events
	count := 0
	for range clientBufferSize {
		select {
		case <-ch:
			count++
		default:
		}
	}
	if count != clientBufferSize {
		t.Errorf("received %d events, want %d", count, clientBufferSize)
	}
}

func TestBroker_UnregisterNonexistent(t *testing.T) {
	b := NewBroker()
	b.Unregister(999) // Should not panic
}

func TestBroker_RejectsWhenAtMaxClients(t *testing.T) {
	b := NewBroker()
	// Fill up to max
	for range MaxSSEClients {
		_, _, err := b.Register("")
		if err != nil {
			t.Fatalf("unexpected error registering client: %v", err)
		}
	}

	if b.ClientCount() != MaxSSEClients {
		t.Fatalf("client count = %d, want %d", b.ClientCount(), MaxSSEClients)
	}

	// Next registration should fail
	_, _, err := b.Register("")
	if err != ErrTooManyClients {
		t.Fatalf("expected ErrTooManyClients, got %v", err)
	}

	if b.ClientCount() != MaxSSEClients {
		t.Fatalf("client count = %d after rejected registration, want %d", b.ClientCount(), MaxSSEClients)
	}
}

func TestBroker_ProjectScopedBroadcast(t *testing.T) {
	b := NewBroker()
	_, scoped, _ := b.Register("project-a")
	_, unscoped, _ := b.Register("")

	b.Broadcast(Event{ID: "1-0", Type: "finding_changed", ProjectID: "project-b", Data: "{}"})

	select {
	case <-scoped:
		t.Fatal("scoped subscriber received wrong project event")
	default:
	}

	select {
	case <-unscoped:
	case <-time.After(time.Second):
		t.Fatal("unscoped subscriber did not receive event")
	}

	b.Broadcast(Event{ID: "2-0", Type: "finding_changed", ProjectID: "project-a", Data: "{}"})

	select {
	case <-scoped:
	case <-time.After(time.Second):
		t.Fatal("scoped subscriber did not receive matching project event")
	}
}
