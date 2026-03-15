package scanner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRunScan_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/scanner.v1.ScannerService/RunScan" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("content-type = %q", r.Header.Get("Content-Type"))
		}

		var req RunScanRequest
		json.NewDecoder(r.Body).Decode(&req)
		if req.TargetID != "target-123" {
			t.Errorf("target_id = %q", req.TargetID)
		}

		json.NewEncoder(w).Encode(RunScanResponse{
			ScanID: "scan-456",
			Status: "pending",
		})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	resp, err := client.RunScan(context.Background(), "target-123")
	if err != nil {
		t.Fatalf("RunScan error: %v", err)
	}
	if resp.ScanID != "scan-456" {
		t.Errorf("scan_id = %q, want scan-456", resp.ScanID)
	}
	if resp.Status != "pending" {
		t.Errorf("status = %q, want pending", resp.Status)
	}
}

func TestGetScanStatus_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(GetScanStatusResponse{
			ScanID:      "scan-456",
			Status:      "completed",
			CompletedAt: "2026-03-16T00:00:00Z",
		})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	resp, err := client.GetScanStatus(context.Background(), "scan-456")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if resp.Status != "completed" {
		t.Errorf("status = %q, want completed", resp.Status)
	}
}

func TestRunScan_ConnectError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ConnectError{
			Code:    "not_found",
			Message: "target not found",
		})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	_, err := client.RunScan(context.Background(), "missing")
	if err == nil {
		t.Fatal("expected error")
	}
	ce, ok := err.(*ConnectError)
	if !ok {
		t.Fatalf("expected ConnectError, got %T", err)
	}
	if ce.Code != "not_found" {
		t.Errorf("code = %q, want not_found", ce.Code)
	}
}

func TestRunScan_RetryOnUnavailable(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(ConnectError{
				Code:    "unavailable",
				Message: "service unavailable",
			})
			return
		}
		json.NewEncoder(w).Encode(RunScanResponse{ScanID: "scan-ok", Status: "pending"})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	resp, err := client.RunScan(context.Background(), "target-1")
	if err != nil {
		t.Fatalf("expected success after retry, got: %v", err)
	}
	if resp.ScanID != "scan-ok" {
		t.Errorf("scan_id = %q", resp.ScanID)
	}
	if attempts != 2 {
		t.Errorf("attempts = %d, want 2", attempts)
	}
}

func TestRunScan_NoRetryOnNotFound(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ConnectError{Code: "not_found", Message: "not found"})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	_, err := client.RunScan(context.Background(), "missing")
	if err == nil {
		t.Fatal("expected error")
	}
	if attempts != 1 {
		t.Errorf("attempts = %d, want 1 (no retry on not_found)", attempts)
	}
}

func TestSyncEpss_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/scanner.v1.EnrichmentService/SyncEpss" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(SyncEpssResponse{SyncedCount: 42})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	resp, err := client.SyncEpss(context.Background())
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if resp.SyncedCount != 42 {
		t.Errorf("synced_count = %d, want 42", resp.SyncedCount)
	}
}
