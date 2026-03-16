package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/Kaikei-e/decree/services/gateway/internal/sse"
	"github.com/google/uuid"
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

func TestEndpoints(t *testing.T) {
	t.Parallel()
	pid := uuid.New()

	tests := []struct {
		name       string
		method     string
		path       string
		store      *mockStore
		wantStatus int
	}{
		{
			name:       "healthz",
			method:     "GET",
			path:       "/healthz",
			store:      &mockStore{},
			wantStatus: http.StatusOK,
		},
		{
			name:   "list projects",
			method: "GET",
			path:   "/api/projects",
			store: &mockStore{
				projects: []db.Project{
					{ID: uuid.New(), Name: "test-project", CreatedAt: time.Now()},
				},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:   "list targets",
			method: "GET",
			path:   "/api/projects/" + pid.String() + "/targets",
			store: &mockStore{
				targets: []db.Target{
					{ID: uuid.New(), ProjectID: pid, Name: "my-image", TargetType: "container_image", CreatedAt: time.Now()},
				},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "list targets invalid uuid",
			method:     "GET",
			path:       "/api/projects/not-a-uuid/targets",
			store:      &mockStore{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "list top risks",
			method:     "GET",
			path:       "/api/projects/" + uuid.New().String() + "/top-risks?limit=5",
			store:      &mockStore{topRisks: []db.Finding{}},
			wantStatus: http.StatusOK,
		},
		{
			name:       "list timeline",
			method:     "GET",
			path:       "/api/projects/" + uuid.New().String() + "/timeline",
			store:      &mockStore{timeline: []db.TimelineEvent{}, timelineMore: false},
			wantStatus: http.StatusOK,
		},
		{
			name:       "finding detail not found",
			method:     "GET",
			path:       "/api/findings/" + uuid.New().String(),
			store:      &mockStore{findingDetail: nil},
			wantStatus: http.StatusNotFound,
		},
		{
			name:   "finding detail found",
			method: "GET",
			path:   "/api/findings/" + uuid.New().String(),
			store: &mockStore{findingDetail: &db.FindingDetail{
				Finding: db.Finding{
					InstanceID:  uuid.New(),
					PackageName: "lodash",
					IsActive:    true,
				},
				AdvisorySource: "osv",
				FixVersions:    []string{"4.17.21"},
				Exploits:       []db.ExploitRef{},
				DependencyPath: []db.DependencyEdge{},
			}},
			wantStatus: http.StatusOK,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			router := NewRouter(tt.store, sse.NewBroker())
			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

func TestListProjects_ResponseShape(t *testing.T) {
	t.Parallel()
	store := &mockStore{
		projects: []db.Project{
			{ID: uuid.New(), Name: "test-project", CreatedAt: time.Now()},
		},
	}
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

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

func TestListFindings_Pagination(t *testing.T) {
	t.Parallel()
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

func TestSSEThroughMiddleware(t *testing.T) {
	t.Parallel()
	broker := sse.NewBroker()
	router := NewRouter(&mockStore{}, broker)

	req := httptest.NewRequest("GET", "/api/events?project_id=test", nil)
	ctx, cancel := context.WithCancel(req.Context())
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		router.ServeHTTP(w, req)
	}()

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
	t.Parallel()
	router := NewRouter(&mockStore{projects: []db.Project{}}, sse.NewBroker())
	req := httptest.NewRequest("GET", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("missing CORS header")
	}
}

func TestCORSPreflight(t *testing.T) {
	t.Parallel()
	router := NewRouter(&mockStore{}, sse.NewBroker())
	req := httptest.NewRequest("OPTIONS", "/api/projects", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestPanicRecovery(t *testing.T) {
	t.Parallel()
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

func TestRequestIDHeader(t *testing.T) {
	t.Parallel()
	router := NewRouter(&mockStore{projects: []db.Project{}}, sse.NewBroker())

	t.Run("generated when absent", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest("GET", "/api/projects", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		rid := w.Header().Get("X-Request-ID")
		if rid == "" {
			t.Error("expected X-Request-ID header")
		}
	})

	t.Run("propagated when present", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest("GET", "/api/projects", nil)
		req.Header.Set("X-Request-ID", "my-custom-id")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		rid := w.Header().Get("X-Request-ID")
		if rid != "my-custom-id" {
			t.Errorf("X-Request-ID = %q, want my-custom-id", rid)
		}
	})
}
