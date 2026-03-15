package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscordChannel_Send(t *testing.T) {
	var received map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &received)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	ch := NewDiscordChannel(srv.URL)
	score := float32(9.5)
	msg := NotificationMessage{
		TargetName:     "example-api",
		AdvisoryID:     "CVE-2024-001",
		PackageName:    "lodash",
		PackageVersion: "4.17.20",
		DiffKind:       "new_cve",
		Severity:       "critical",
		DecreeScore:    &score,
	}

	err := ch.Send(context.Background(), msg)
	if err != nil {
		t.Fatalf("Send error: %v", err)
	}

	embeds, ok := received["embeds"].([]any)
	if !ok || len(embeds) == 0 {
		t.Fatal("missing embeds")
	}

	embed := embeds[0].(map[string]any)
	if embed["title"] != "New Vulnerability Detected" {
		t.Errorf("title = %v", embed["title"])
	}
	// Color for critical = 0xe01e5a = 14688858
	if int(embed["color"].(float64)) != 0xe01e5a {
		t.Errorf("color = %v, want critical red", embed["color"])
	}
}

func TestDiscordChannel_Name(t *testing.T) {
	ch := NewDiscordChannel("http://example.com")
	if ch.Name() != "discord" {
		t.Errorf("name = %q", ch.Name())
	}
}
