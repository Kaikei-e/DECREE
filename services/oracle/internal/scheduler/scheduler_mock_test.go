package scheduler

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"decree/services/oracle/internal/config"
	"decree/services/oracle/internal/domain"
	"decree/services/oracle/internal/scanner"
)

// mockTargetStore implements TargetStore for testing.
type mockTargetStore struct {
	targets  []domain.Target
	projects map[string]uuid.UUID
	upserted []string
	cleared  bool
}

func newMockTargetStore() *mockTargetStore {
	return &mockTargetStore{
		projects: make(map[string]uuid.UUID),
	}
}

func (m *mockTargetStore) ListTargets(_ context.Context) ([]domain.Target, error) {
	return m.targets, nil
}

func (m *mockTargetStore) UpsertTarget(_ context.Context, _ uuid.UUID, name, _ string, _, _ *string) (uuid.UUID, error) {
	m.upserted = append(m.upserted, name)
	return uuid.New(), nil
}

func (m *mockTargetStore) EnsureProject(_ context.Context, name string) (uuid.UUID, error) {
	id, ok := m.projects[name]
	if !ok {
		id = uuid.New()
		m.projects[name] = id
	}
	return id, nil
}

func (m *mockTargetStore) ClearExpiredLeases(_ context.Context) error {
	m.cleared = true
	return nil
}

// mockScannerService implements ScannerService for testing.
type mockScannerService struct {
	runScanResp      *scanner.RunScanResponse
	scanStatusFn     func() *scanner.GetScanStatusResponse
	runScanCalled    bool
	syncEpssCalls    int
	syncNvdCalls     int
	syncExploitCalls int
	recalculateCalls int
}

func (m *mockScannerService) RunScan(_ context.Context, _ string) (*scanner.RunScanResponse, error) {
	m.runScanCalled = true
	return m.runScanResp, nil
}

func (m *mockScannerService) GetScanStatus(_ context.Context, _ string) (*scanner.GetScanStatusResponse, error) {
	return m.scanStatusFn(), nil
}

func (m *mockScannerService) SyncEpss(_ context.Context) (*scanner.SyncEpssResponse, error) {
	m.syncEpssCalls++
	return &scanner.SyncEpssResponse{}, nil
}

func (m *mockScannerService) SyncNvd(_ context.Context) (*scanner.SyncNvdResponse, error) {
	m.syncNvdCalls++
	return &scanner.SyncNvdResponse{}, nil
}

func (m *mockScannerService) SyncExploitDb(_ context.Context) (*scanner.SyncExploitDbResponse, error) {
	m.syncExploitCalls++
	return &scanner.SyncExploitDbResponse{}, nil
}

func (m *mockScannerService) RecalculateScores(_ context.Context, _ []string) (*scanner.RecalculateScoresResponse, error) {
	m.recalculateCalls++
	return &scanner.RecalculateScoresResponse{}, nil
}

func TestSeedTargets_WithMock(t *testing.T) {
	store := newMockTargetStore()

	cfg := &config.Config{
		Project: config.ProjectConfig{Name: "test-project"},
		Targets: config.TargetsConfig{
			Repositories: []config.RepositoryTarget{
				{Name: "repo-1", URL: "https://github.com/test/repo1", Branch: "main"},
				{Name: "repo-2", URL: "https://github.com/test/repo2", Branch: "develop"},
			},
			Containers: []config.ContainerTarget{
				{Name: "container-1", Image: "nginx:latest"},
			},
		},
	}

	s := New(cfg, store, nil, nil)
	err := s.seedTargets(context.Background())
	if err != nil {
		t.Fatalf("seedTargets() error: %v", err)
	}

	if len(store.upserted) != 3 {
		t.Errorf("upserted %d targets, want 3", len(store.upserted))
	}

	if _, ok := store.projects["test-project"]; !ok {
		t.Error("project was not ensured")
	}
}

func TestTriggerScan_WithMock(t *testing.T) {
	store := newMockTargetStore()
	scanSvc := &mockScannerService{
		runScanResp: &scanner.RunScanResponse{ScanID: uuid.New().String()},
		scanStatusFn: func() *scanner.GetScanStatusResponse {
			return &scanner.GetScanStatusResponse{Status: "completed"}
		},
	}

	cfg := &config.Config{
		Scan: config.ScanConfig{
			Interval: config.Duration{Duration: 1 * time.Minute},
		},
	}

	lm := &LeaseManager{holderID: "test"}
	s := New(cfg, store, scanSvc, lm)

	target := domain.Target{
		ID:   uuid.New(),
		Name: "test-target",
	}

	s.triggerScan(context.Background(), target)

	if !scanSvc.runScanCalled {
		t.Error("RunScan was not called")
	}

	// Verify next run was set
	s.mu.Lock()
	_, exists := s.nextRun[target.ID]
	s.mu.Unlock()

	if !exists {
		t.Error("nextRun was not set after triggerScan")
	}
}

func TestTick_SkipsNotDue(t *testing.T) {
	targetID := uuid.New()
	store := newMockTargetStore()
	store.targets = []domain.Target{{ID: targetID, Name: "test"}}

	scanSvc := &mockScannerService{}

	cfg := &config.Config{
		Scan: config.ScanConfig{
			Interval: config.Duration{Duration: 1 * time.Minute},
		},
	}

	lm := &LeaseManager{holderID: "test"}
	s := New(cfg, store, scanSvc, lm)

	// Set next run in the future
	s.mu.Lock()
	s.nextRun[targetID] = time.Now().Add(10 * time.Minute)
	s.mu.Unlock()

	s.tick(context.Background())

	if scanSvc.runScanCalled {
		t.Error("RunScan should not be called when target is not due")
	}
}

func TestRunEnrichmentRefresh_TriggersInitialSync(t *testing.T) {
	scanSvc := &mockScannerService{}
	cfg := &config.Config{
		Scan: config.ScanConfig{
			VulnerabilityRefresh: config.VulnerabilityRefreshConfig{
				EPSS: config.Duration{Duration: time.Hour},
				NVD:  config.Duration{Duration: time.Hour},
			},
		},
	}

	s := New(cfg, newMockTargetStore(), scanSvc, nil)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.runEnrichmentRefresh(ctx)
	}()

	time.Sleep(20 * time.Millisecond)
	cancel()
	<-done

	if scanSvc.syncEpssCalls == 0 {
		t.Fatal("expected initial EPSS sync")
	}
	if scanSvc.syncNvdCalls == 0 {
		t.Fatal("expected initial NVD sync")
	}
	if scanSvc.syncExploitCalls == 0 {
		t.Fatal("expected initial ExploitDB sync")
	}
	if scanSvc.recalculateCalls < 2 {
		t.Fatalf("expected score recalculation after initial enrichment refreshes, got %d", scanSvc.recalculateCalls)
	}
}
