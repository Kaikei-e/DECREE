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

// The timeline pages on (occurred_at, id), so its tie-break has to run in the
// same direction as the ORDER BY or events sharing a timestamp are skipped.
func TestListTimeline_KeysetPaginationCoversEveryEventOnce(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()

	projects, err := store.ListProjects(ctx)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(projects) == 0 {
		t.Skip("no projects seeded")
	}
	var projectID uuid.UUID
	var want []TimelineEvent
	for _, p := range projects {
		events, more, err := store.ListTimeline(ctx, TimelineParams{ProjectID: p.ID, Limit: 50000})
		if err != nil {
			t.Fatalf("ListTimeline: %v", err)
		}
		if more {
			t.Fatalf("project %s exceeded the test limit", p.Name)
		}
		if len(events) > len(want) {
			projectID, want = p.ID, events
		}
	}
	if len(want) == 0 {
		t.Skip("no timeline events seeded")
	}

	var got []TimelineEvent
	params := TimelineParams{ProjectID: projectID, Limit: 250}
	for i := 0; ; i++ {
		if i > len(want)/params.Limit+5 {
			t.Fatalf("pagination did not terminate; collected %d events", len(got))
		}
		page, hasMore, err := store.ListTimeline(ctx, params)
		if err != nil {
			t.Fatalf("ListTimeline: %v", err)
		}
		got = append(got, page...)
		if !hasMore {
			break
		}
		last := page[len(page)-1]
		params.Cursor = &TimelineCursor{OccurredAt: last.OccurredAt, ID: last.ID}
	}

	if len(got) != len(want) {
		t.Errorf("paged read returned %d events, unpaged returned %d", len(got), len(want))
	}
	seen := map[uuid.UUID]int{}
	for _, e := range got {
		seen[e.ID]++
		if seen[e.ID] > 1 {
			t.Fatalf("event %s returned %d times", e.ID, seen[e.ID])
		}
	}
	for _, e := range want {
		if seen[e.ID] == 0 {
			t.Errorf("event %s (%s) never returned", e.ID, e.OccurredAt)
		}
	}

	// A page boundary inside a group of events sharing a timestamp is the only
	// case the tie-break decides, so drive one deliberately.
	var tied time.Time
	err = store.pool.QueryRow(ctx, `
		SELECT vo.observed_at
		FROM vulnerability_observations vo
		JOIN vulnerability_instances vi ON vi.id = vo.instance_id
		JOIN targets t ON t.id = vi.target_id
		WHERE t.project_id = $1
		GROUP BY vo.observed_at
		HAVING count(*) > 1
		LIMIT 1
	`, projectID).Scan(&tied)
	if err != nil {
		t.Skipf("no tied timeline timestamps seeded: %v", err)
	}

	window := TimelineParams{ProjectID: projectID, From: &tied, To: &tied, Limit: 1}
	all, _, err := store.ListTimeline(ctx, TimelineParams{ProjectID: projectID, From: &tied, To: &tied, Limit: 100})
	if err != nil {
		t.Fatalf("ListTimeline: %v", err)
	}

	var walked []TimelineEvent
	for i := 0; i <= len(all)+2; i++ {
		page, hasMore, err := store.ListTimeline(ctx, window)
		if err != nil {
			t.Fatalf("ListTimeline: %v", err)
		}
		walked = append(walked, page...)
		if !hasMore {
			break
		}
		last := page[len(page)-1]
		window.Cursor = &TimelineCursor{OccurredAt: last.OccurredAt, ID: last.ID}
	}
	if len(walked) != len(all) {
		t.Errorf("paging one-by-one through %s returned %d of %d tied events",
			tied, len(walked), len(all))
	}
}
