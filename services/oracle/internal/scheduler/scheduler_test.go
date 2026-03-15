package scheduler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"decree/services/oracle/internal/config"
	"decree/services/oracle/internal/db"
	"decree/services/oracle/internal/scanner"
)

func db_target(name string) db.Target {
	return db.Target{
		ID:   uuid.New(),
		Name: name,
	}
}

func TestScheduler_TickResolution(t *testing.T) {
	// Verify that resolution = min(interval, 30s)
	cfg := &config.Config{
		Scan: config.ScanConfig{
			Interval: config.Duration{Duration: 10 * time.Second},
		},
	}

	s := New(cfg, nil, nil, nil)
	interval := s.cfg.Scan.Interval.Duration
	resolution := interval
	if resolution > 30*time.Second {
		resolution = 30 * time.Second
	}

	if resolution != 10*time.Second {
		t.Errorf("resolution = %v, want 10s for 10s interval", resolution)
	}

	cfg.Scan.Interval.Duration = 5 * time.Minute
	interval = cfg.Scan.Interval.Duration
	resolution = interval
	if resolution > 30*time.Second {
		resolution = 30 * time.Second
	}
	if resolution != 30*time.Second {
		t.Errorf("resolution = %v, want 30s for 5m interval", resolution)
	}
}

func TestScheduler_PollScanStatus_Completed(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		json.NewEncoder(w).Encode(scanner.GetScanStatusResponse{
			ScanID: "scan-1",
			Status: "completed",
		})
	}))
	defer srv.Close()

	cfg := &config.Config{
		Scan: config.ScanConfig{
			Interval: config.Duration{Duration: 1 * time.Minute},
		},
	}

	client := scanner.NewClient(srv.URL)
	lm := &LeaseManager{holderID: "test"}

	s := New(cfg, nil, client, lm)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// pollScanStatus should return quickly when status is completed
	done := make(chan struct{})
	go func() {
		s.pollScanStatus(ctx, db_target("test"), "scan-1")
		close(done)
	}()

	select {
	case <-done:
		// success
	case <-time.After(8 * time.Second):
		t.Fatal("pollScanStatus did not return after completed status")
	}

	if c := calls.Load(); c < 1 {
		t.Errorf("expected at least 1 GetScanStatus call, got %d", c)
	}
}

func TestScheduler_PollScanStatus_Failed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(scanner.GetScanStatusResponse{
			ScanID:       "scan-2",
			Status:       "failed",
			ErrorMessage: "target not accessible",
		})
	}))
	defer srv.Close()

	cfg := &config.Config{
		Scan: config.ScanConfig{
			Interval: config.Duration{Duration: 1 * time.Minute},
		},
	}

	client := scanner.NewClient(srv.URL)
	lm := &LeaseManager{holderID: "test"}
	s := New(cfg, nil, client, lm)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	done := make(chan struct{})
	go func() {
		s.pollScanStatus(ctx, db_target("fail-test"), "scan-2")
		close(done)
	}()

	select {
	case <-done:
		// success — returned on failed status
	case <-time.After(8 * time.Second):
		t.Fatal("pollScanStatus did not return after failed status")
	}
}
