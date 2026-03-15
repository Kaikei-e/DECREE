package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSlackChannel_Send(t *testing.T) {
	var received map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &received)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewSlackChannel(srv.URL)
	score := float32(8.5)
	msg := NotificationMessage{
		TargetName:     "example-api",
		AdvisoryID:     "CVE-2024-001",
		PackageName:    "lodash",
		PackageVersion: "4.17.20",
		Ecosystem:      "npm",
		DiffKind:       "new_cve",
		Severity:       "high",
		DecreeScore:    &score,
		HasExploit:     true,
		FixVersions:    []string{"4.17.21"},
	}

	err := ch.Send(context.Background(), msg)
	if err != nil {
		t.Fatalf("Send error: %v", err)
	}

	attachments, ok := received["attachments"].([]any)
	if !ok || len(attachments) == 0 {
		t.Fatal("missing attachments")
	}

	att := attachments[0].(map[string]any)
	if att["color"] != "#ff9900" {
		t.Errorf("color = %v, want orange for high", att["color"])
	}
}

func TestSlackChannel_Name(t *testing.T) {
	ch := NewSlackChannel("http://example.com")
	if ch.Name() != "slack" {
		t.Errorf("name = %q", ch.Name())
	}
}

func TestSlackChannel_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	ch := NewSlackChannel(srv.URL)
	err := ch.Send(context.Background(), NotificationMessage{})
	if err == nil {
		t.Fatal("expected error for 500")
	}
}

func TestSeverityColor(t *testing.T) {
	tests := []struct {
		severity string
		want     string
	}{
		{"critical", "#e01e5a"},
		{"high", "#ff9900"},
		{"medium", "#f2c744"},
		{"low", "#cccccc"},
		{"unknown", "#cccccc"},
	}

	for _, tt := range tests {
		got := severityColor(tt.severity)
		if got != tt.want {
			t.Errorf("severityColor(%q) = %q, want %q", tt.severity, got, tt.want)
		}
	}
}

func TestDiffKindTitle(t *testing.T) {
	tests := []struct {
		kind string
		want string
	}{
		{"new_cve", "New Vulnerability Detected"},
		{"resolved_cve", "Vulnerability Resolved"},
		{"score_change", "DECREE Score Changed"},
		{"new_exploit", "New Exploit Available"},
		{"unknown", "Vulnerability Update"},
	}

	for _, tt := range tests {
		got := diffKindTitle(tt.kind)
		if got != tt.want {
			t.Errorf("diffKindTitle(%q) = %q, want %q", tt.kind, got, tt.want)
		}
	}
}
