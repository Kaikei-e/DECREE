//go:build integration

package db

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func testPool(t *testing.T) *PgStore {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewPgStore(pool)
}

func TestListProjects(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()

	projects, err := store.ListProjects(ctx)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if projects == nil {
		t.Fatal("expected non-nil slice")
	}
}

func TestListTargets(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()

	targets, err := store.ListTargets(ctx, uuid.New())
	if err != nil {
		t.Fatalf("ListTargets: %v", err)
	}
	if targets == nil {
		t.Fatal("expected non-nil slice")
	}
	if len(targets) != 0 {
		t.Errorf("expected 0 targets for random project, got %d", len(targets))
	}
}

func TestGetFindingDetail_NotFound(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()

	detail, err := store.GetFindingDetail(ctx, uuid.New())
	if err != nil {
		t.Fatalf("GetFindingDetail: %v", err)
	}
	if detail != nil {
		t.Error("expected nil for non-existent finding")
	}
}
