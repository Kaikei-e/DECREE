package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWebhookChannel_Send(t *testing.T) {
	var received NotificationMessage
	var gotHeaders http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &received)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewWebhookChannel(srv.URL, "POST", map[string]string{
		"Authorization": "Bearer test-token",
	})

	msg := NotificationMessage{
		TargetName:  "example-api",
		AdvisoryID:  "CVE-2024-001",
		PackageName: "lodash",
		DiffKind:    "new_cve",
		Severity:    "high",
	}

	err := ch.Send(context.Background(), msg)
	if err != nil {
		t.Fatalf("Send error: %v", err)
	}

	if received.AdvisoryID != "CVE-2024-001" {
		t.Errorf("advisory = %q", received.AdvisoryID)
	}
	if gotHeaders.Get("Authorization") != "Bearer test-token" {
		t.Errorf("auth header = %q", gotHeaders.Get("Authorization"))
	}
}

func TestWebhookChannel_Name(t *testing.T) {
	ch := NewWebhookChannel("http://example.com", "", nil)
	if ch.Name() != "webhook" {
		t.Errorf("name = %q", ch.Name())
	}
}

func TestWebhookChannel_DefaultMethod(t *testing.T) {
	ch := NewWebhookChannel("http://example.com", "", nil)
	if ch.method != "POST" {
		t.Errorf("method = %q, want POST", ch.method)
	}
}

func TestWebhookChannel_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	ch := NewWebhookChannel(srv.URL, "POST", nil)
	err := ch.Send(context.Background(), NotificationMessage{})
	if err == nil {
		t.Fatal("expected error for 403")
	}
}
