package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSendJSON_Success(t *testing.T) {
	var received map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	payload := map[string]string{"key": "value"}
	err := sendJSON(context.Background(), srv.Client(), http.MethodPost, srv.URL, nil, payload, http.StatusOK)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["key"] != "value" {
		t.Errorf("received = %v", received)
	}
}

func TestSendJSON_CustomHeaders(t *testing.T) {
	var authHeader string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	headers := map[string]string{"Authorization": "Bearer token123"}
	err := sendJSON(context.Background(), srv.Client(), http.MethodPost, srv.URL, headers, struct{}{}, http.StatusOK)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer token123" {
		t.Errorf("auth header = %q", authHeader)
	}
}

func TestSendJSON_RejectsUnexpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	err := sendJSON(context.Background(), srv.Client(), http.MethodPost, srv.URL, nil, struct{}{}, http.StatusOK)
	if err == nil {
		t.Fatal("expected error for 500 status")
	}
}

func TestSendJSON_DefaultAcceptsNonError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	err := sendJSON(context.Background(), srv.Client(), http.MethodPost, srv.URL, nil, struct{}{})
	if err != nil {
		t.Fatalf("201 should be accepted with default validation: %v", err)
	}
}

func TestSendJSON_DefaultRejectsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	err := sendJSON(context.Background(), srv.Client(), http.MethodPost, srv.URL, nil, struct{}{})
	if err == nil {
		t.Fatal("403 should be rejected with default validation")
	}
}
