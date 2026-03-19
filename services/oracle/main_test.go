package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"
)

type mockBackfiller struct {
	count int64
	err   error
	calls int
}

func (m *mockBackfiller) BackfillResolvedFindings(ctx context.Context) (int64, error) {
	m.calls++
	return m.count, m.err
}

func TestRunStartupBackfill_SwallowsError(t *testing.T) {
	mock := &mockBackfiller{err: errors.New("db exploded")}

	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	defer slog.SetDefault(old)

	// Must not panic or propagate error.
	runStartupBackfill(context.Background(), mock)

	if !bytes.Contains(buf.Bytes(), []byte("backfill resolved findings failed")) {
		t.Error("expected warn log about failure")
	}
}

func TestRunStartupBackfill_LogsOnlyWhenRowsUpdated(t *testing.T) {
	t.Run("zero rows no info log", func(t *testing.T) {
		mock := &mockBackfiller{count: 0}

		var buf bytes.Buffer
		old := slog.Default()
		slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
		defer slog.SetDefault(old)

		runStartupBackfill(context.Background(), mock)

		if bytes.Contains(buf.Bytes(), []byte("backfilled resolved findings")) {
			t.Error("should not log info when count is 0")
		}
	})

	t.Run("positive rows logs info", func(t *testing.T) {
		mock := &mockBackfiller{count: 5}

		var buf bytes.Buffer
		old := slog.Default()
		slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
		defer slog.SetDefault(old)

		runStartupBackfill(context.Background(), mock)

		out := buf.String()
		if !bytes.Contains([]byte(out), []byte("backfilled resolved findings")) {
			t.Error("expected info log with message")
		}
		if !bytes.Contains([]byte(out), []byte(`"count":5`)) {
			t.Error("expected count in log")
		}
	})
}

func TestRunStartupBackfill_CallsBackfillOnce(t *testing.T) {
	mock := &mockBackfiller{count: 3}

	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)))
	defer slog.SetDefault(old)

	runStartupBackfill(context.Background(), mock)

	if mock.calls != 1 {
		t.Errorf("expected 1 call, got %d", mock.calls)
	}
}
