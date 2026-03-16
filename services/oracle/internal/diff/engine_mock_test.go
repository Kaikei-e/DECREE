package diff

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"decree/services/oracle/internal/domain"
)

// mockObservationReader provides a test double for ObservationReader.
type mockObservationReader struct {
	targetName  string
	projectID   uuid.UUID
	current     []domain.Observation
	previous    []domain.Observation
	prevScanID  uuid.UUID
	prevScanErr error
	exploits    map[string]bool
	fixVersions map[uuid.UUID][]string

	disappearances   []uuid.UUID
	outboxEvents     []any
	exploitCallCount int
}

func (m *mockObservationReader) GetTargetName(_ context.Context, _ uuid.UUID) (string, error) {
	return m.targetName, nil
}

func (m *mockObservationReader) GetTargetProjectID(_ context.Context, _ uuid.UUID) (uuid.UUID, error) {
	return m.projectID, nil
}

func (m *mockObservationReader) GetCurrentObservations(_ context.Context, scanID uuid.UUID) ([]domain.Observation, error) {
	if scanID == m.prevScanID {
		return m.previous, nil
	}
	return m.current, nil
}

func (m *mockObservationReader) GetPreviousCompletedScanID(_ context.Context, _, _ uuid.UUID) (uuid.UUID, error) {
	if m.prevScanErr != nil {
		return uuid.Nil, m.prevScanErr
	}
	return m.prevScanID, nil
}

func (m *mockObservationReader) GetExploitLinkedCVEs(_ context.Context, _ []string) (map[string]bool, error) {
	m.exploitCallCount++
	if m.exploits == nil {
		return map[string]bool{}, nil
	}
	return m.exploits, nil
}

func (m *mockObservationReader) GetFixVersions(_ context.Context, instanceID uuid.UUID) ([]string, error) {
	if m.fixVersions != nil {
		return m.fixVersions[instanceID], nil
	}
	return nil, nil
}

func (m *mockObservationReader) InsertDisappearance(_ context.Context, instanceID, _ uuid.UUID) error {
	m.disappearances = append(m.disappearances, instanceID)
	return nil
}

func (m *mockObservationReader) InsertOutboxEvent(_ context.Context, _ string, payload any) error {
	m.outboxEvents = append(m.outboxEvents, payload)
	return nil
}

func TestDetect_FirstScan_AllNew(t *testing.T) {
	instanceID := uuid.New()
	score := float32(7.5)

	repo := &mockObservationReader{
		targetName: "test-target",
		projectID:  uuid.New(),
		current: []domain.Observation{
			{
				InstanceID:     instanceID,
				PackageName:    "lodash",
				PackageVersion: "4.17.20",
				Ecosystem:      "npm",
				AdvisoryID:     "CVE-2024-001",
				DecreeScore:    &score,
				Severity:       "high",
			},
		},
		prevScanErr: pgx.ErrNoRows,
	}

	engine := NewEngine(repo)
	events, err := engine.Detect(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Detect() error: %v", err)
	}

	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Kind != DiffNewCVE {
		t.Errorf("kind = %q, want new_cve", events[0].Kind)
	}
	if events[0].PackageName != "lodash" {
		t.Errorf("package = %q, want lodash", events[0].PackageName)
	}
}

func TestDetect_NewAndResolved(t *testing.T) {
	prevScanID := uuid.New()
	existingID := uuid.New()
	resolvedID := uuid.New()
	newID := uuid.New()
	score := float32(5.0)

	repo := &mockObservationReader{
		targetName: "test-target",
		projectID:  uuid.New(),
		prevScanID: prevScanID,
		current: []domain.Observation{
			{InstanceID: existingID, AdvisoryID: "CVE-2024-001", DecreeScore: &score, Severity: "medium"},
			{InstanceID: newID, AdvisoryID: "CVE-2024-003", DecreeScore: &score, Severity: "high"},
		},
		previous: []domain.Observation{
			{InstanceID: existingID, AdvisoryID: "CVE-2024-001", DecreeScore: &score, Severity: "medium"},
			{InstanceID: resolvedID, AdvisoryID: "CVE-2024-002", DecreeScore: &score, Severity: "low"},
		},
	}

	engine := NewEngine(repo)
	events, err := engine.Detect(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Detect() error: %v", err)
	}

	kinds := map[DiffKind]int{}
	for _, e := range events {
		kinds[e.Kind]++
	}

	if kinds[DiffNewCVE] != 1 {
		t.Errorf("new_cve count = %d, want 1", kinds[DiffNewCVE])
	}
	if kinds[DiffResolvedCVE] != 1 {
		t.Errorf("resolved_cve count = %d, want 1", kinds[DiffResolvedCVE])
	}

	if len(repo.disappearances) != 1 || repo.disappearances[0] != resolvedID {
		t.Errorf("disappearances = %v, want [%s]", repo.disappearances, resolvedID)
	}
}

func TestDetect_ScoreChange(t *testing.T) {
	prevScanID := uuid.New()
	instanceID := uuid.New()
	oldScore := float32(3.0)
	newScore := float32(8.0)

	repo := &mockObservationReader{
		targetName: "test-target",
		projectID:  uuid.New(),
		prevScanID: prevScanID,
		current: []domain.Observation{
			{InstanceID: instanceID, AdvisoryID: "CVE-2024-001", DecreeScore: &newScore, Severity: "high"},
		},
		previous: []domain.Observation{
			{InstanceID: instanceID, AdvisoryID: "CVE-2024-001", DecreeScore: &oldScore, Severity: "high"},
		},
	}

	engine := NewEngine(repo)
	events, err := engine.Detect(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Detect() error: %v", err)
	}

	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Kind != DiffScoreChange {
		t.Errorf("kind = %q, want score_change", events[0].Kind)
	}
	if events[0].PrevScore == nil || *events[0].PrevScore != oldScore {
		t.Errorf("prev_score = %v, want %v", events[0].PrevScore, oldScore)
	}
}

// exploitAwareMockReader differentiates between current and previous exploit lookups.
type exploitAwareMockReader struct {
	mockObservationReader
	currentScanID   uuid.UUID
	currentExploits map[string]bool
	prevExploits    map[string]bool
	exploitCalls    int
}

func (m *exploitAwareMockReader) GetExploitLinkedCVEs(_ context.Context, _ []string) (map[string]bool, error) {
	m.exploitCalls++
	if m.exploitCalls == 1 {
		return m.currentExploits, nil
	}
	return m.prevExploits, nil
}

func TestDetect_NewExploit(t *testing.T) {
	prevScanID := uuid.New()
	scanID := uuid.New()
	instanceID := uuid.New()
	score := float32(5.0)

	// Use callAware mock that returns exploits only for the "current" call
	repo := &exploitAwareMockReader{
		mockObservationReader: mockObservationReader{
			targetName: "test-target",
			projectID:  uuid.New(),
			prevScanID: prevScanID,
			current: []domain.Observation{
				{InstanceID: instanceID, AdvisoryID: "CVE-2024-001", DecreeScore: &score, Severity: "high"},
			},
			previous: []domain.Observation{
				{InstanceID: instanceID, AdvisoryID: "CVE-2024-001", DecreeScore: &score, Severity: "high"},
			},
		},
		currentScanID:   scanID,
		currentExploits: map[string]bool{"CVE-2024-001": true},
		prevExploits:    map[string]bool{},
	}

	engine := NewEngine(repo)
	events, err := engine.Detect(context.Background(), scanID, uuid.New())
	if err != nil {
		t.Fatalf("Detect() error: %v", err)
	}

	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Kind != DiffNewExploit {
		t.Errorf("kind = %q, want new_exploit", events[0].Kind)
	}
	if !events[0].HasExploit {
		t.Error("should have exploit flag")
	}
}

func TestDetect_OutboxEventsCreated(t *testing.T) {
	prevScanID := uuid.New()
	newID := uuid.New()
	score := float32(7.5)

	repo := &mockObservationReader{
		targetName: "test-target",
		projectID:  uuid.New(),
		prevScanID: prevScanID,
		current: []domain.Observation{
			{InstanceID: newID, AdvisoryID: "CVE-2024-001", DecreeScore: &score, Severity: "high"},
		},
		previous: []domain.Observation{}, // empty previous → newID is new_cve
	}

	engine := NewEngine(repo)
	_, err := engine.Detect(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Detect() error: %v", err)
	}

	if len(repo.outboxEvents) != 1 {
		t.Errorf("outbox events = %d, want 1", len(repo.outboxEvents))
	}
}
