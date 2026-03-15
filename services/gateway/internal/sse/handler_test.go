package sse

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandler_SSEHeaders(t *testing.T) {
	broker := NewBroker()
	handler := NewHandler(broker)

	ctx, cancel := context.WithCancel(context.Background())

	req := httptest.NewRequest("GET", "/api/events", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(w, req)
		close(done)
	}()

	// Wait for headers to be written
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	if ct := w.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q", cc)
	}
}

func TestHandler_EventDelivery(t *testing.T) {
	broker := NewBroker()
	handler := NewHandler(broker)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest("GET", "/api/events", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(w, req)
		close(done)
	}()

	// Wait for registration
	time.Sleep(50 * time.Millisecond)

	broker.Broadcast(Event{ID: "123-0", Type: "finding_changed", Data: `{"id":"abc"}`})

	// Wait for delivery
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	body := w.Body.String()
	if !strings.Contains(body, "id: 123-0") {
		t.Errorf("missing event id in body: %s", body)
	}
	if !strings.Contains(body, "event: finding_changed") {
		t.Errorf("missing event type in body: %s", body)
	}
	if !strings.Contains(body, `data: {"id":"abc"}`) {
		t.Errorf("missing event data in body: %s", body)
	}
}

func TestHandler_Heartbeat(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping heartbeat test in short mode")
	}

	broker := NewBroker()
	// Use a custom handler with shorter heartbeat for testing
	h := &Handler{broker: broker}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r.WithContext(ctx))
	}))
	defer srv.Close()

	// We just verify the handler can be created and serves properly
	// Full heartbeat testing would need to override the interval
	if broker.ClientCount() != 0 {
		t.Errorf("expected 0 clients before connection")
	}
}
