package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/Kaikei-e/decree/services/gateway/internal/sse"
)

// mockStore implements db.Store for testing.
type mockStore struct {
	projects      []db.Project
	targets       []db.Target
	findings      []db.Finding
	findingsMore  bool
	findingDetail *db.FindingDetail
	topRisks      []db.Finding
	timeline      []db.TimelineEvent
	timelineMore  bool
	err           error
}

func (m *mockStore) ListProjects(ctx context.Context) ([]db.Project, error) {
	return m.projects, m.err
}
func (m *mockStore) ListTargets(ctx context.Context, projectID uuid.UUID) ([]db.Target, error) {
	return m.targets, m.err
}
func (m *mockStore) ListFindings(ctx context.Context, params db.FindingParams) ([]db.Finding, bool, error) {
	return m.findings, m.findingsMore, m.err
}
func (m *mockStore) GetFindingDetail(ctx context.Context, instanceID uuid.UUID) (*db.FindingDetail, error) {
	return m.findingDetail, m.err
}
func (m *mockStore) ListTopRisks(ctx context.Context, projectID uuid.UUID, limit int) ([]db.Finding, error) {
	return m.topRisks, m.err
}
func (m *mockStore) ListTimeline(ctx context.Context, params db.TimelineParams) ([]db.TimelineEvent, bool, error) {
	return m.timeline, m.timelineMore, m.err
}

func TestHealthz(t *testing.T) {
	router := NewRouter(&mockStore{}, sse.NewBroker())
	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["status"] != "ok" {
		t.Errorf("status = %q", body["status"])
	}
}

func TestListProjects(t *testing.T) {
	store := &mockStore{
		projects: []db.Project{
			{ID: uuid.New(), Name: "test-project", CreatedAt: time.Now()},
		},
	}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body struct {
		Data []db.Project `json:"data"`
	}
	json.NewDecoder(w.Body).Decode(&body)
	if len(body.Data) != 1 {
		t.Errorf("got %d projects, want 1", len(body.Data))
	}
	if body.Data[0].Name != "test-project" {
		t.Errorf("name = %q", body.Data[0].Name)
	}
}

func TestListTargets(t *testing.T) {
	pid := uuid.New()
	store := &mockStore{
		targets: []db.Target{
			{ID: uuid.New(), ProjectID: pid, Name: "my-image", TargetType: "container_image", CreatedAt: time.Now()},
		},
	}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects/"+pid.String()+"/targets", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestListTargets_InvalidUUID(t *testing.T) {
	router := NewRouter(&mockStore{}, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects/not-a-uuid/targets", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestListFindings_Pagination(t *testing.T) {
	score := float32(8.5)
	store := &mockStore{
		findings: []db.Finding{
			{InstanceID: uuid.New(), PackageName: "pkg1", DecreeScore: &score, IsActive: true},
		},
		findingsMore: true,
	}
	router := NewRouter(store, sse.NewBroker())
	pid := uuid.New()
	req := httptest.NewRequest("GET", "/api/projects/"+pid.String()+"/findings?active_only=true&limit=1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body PagedResponse[db.Finding]
	json.NewDecoder(w.Body).Decode(&body)
	if !body.HasMore {
		t.Error("expected has_more=true")
	}
	if body.NextCursor == nil {
		t.Error("expected next_cursor")
	}
}

func TestGetFindingDetail_NotFound(t *testing.T) {
	store := &mockStore{findingDetail: nil}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/findings/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestGetFindingDetail_Found(t *testing.T) {
	detail := &db.FindingDetail{
		Finding: db.Finding{
			InstanceID:  uuid.New(),
			PackageName: "lodash",
			IsActive:    true,
		},
		AdvisorySource: "osv",
		FixVersions:    []string{"4.17.21"},
		Exploits:       []db.ExploitRef{},
		DependencyPath: []db.DependencyEdge{},
	}
	store := &mockStore{findingDetail: detail}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/findings/"+detail.InstanceID.String(), nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestListTopRisks(t *testing.T) {
	store := &mockStore{topRisks: []db.Finding{}}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects/"+uuid.New().String()+"/top-risks?limit=5", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestListTimeline(t *testing.T) {
	store := &mockStore{timeline: []db.TimelineEvent{}, timelineMore: false}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects/"+uuid.New().String()+"/timeline", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestSSEThroughMiddleware(t *testing.T) {
	broker := sse.NewBroker()
	router := NewRouter(&mockStore{}, broker)

	req := httptest.NewRequest("GET", "/api/events?project_id=test", nil)
	// Use a context with cancel so the SSE handler terminates.
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		router.ServeHTTP(w, req)
	}()

	// Give the handler a moment to write headers, then cancel.
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	ct := w.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
}

func TestCORSHeaders(t *testing.T) {
	router := NewRouter(&mockStore{projects: []db.Project{}}, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("missing CORS header")
	}
}

func TestCORSPreflight(t *testing.T) {
	router := NewRouter(&mockStore{}, sse.NewBroker())
	req := httptest.NewRequest("OPTIONS", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestPanicRecovery(t *testing.T) {
	panicStore := &panicOnListStore{}
	router := NewRouter(panicStore, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}

type panicOnListStore struct{ mockStore }

func (p *panicOnListStore) ListProjects(ctx context.Context) ([]db.Project, error) {
	panic("test panic")
}
