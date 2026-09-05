package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/Kaikei-e/decree/services/gateway/internal/sse"
	"github.com/google/uuid"
)

func doGet(t *testing.T, store db.Store, path string) *httptest.ResponseRecorder {
	t.Helper()
	router := NewRouter(store, sse.NewBroker())
	req := httptest.NewRequest("GET", path, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body ErrorBody
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	return body.Error.Code
}

func TestFindings_SortWhitelist(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()

	accepted := map[string]struct {
		key  db.SortKey
		desc bool
	}{
		"decree_score":  {db.SortDecreeScore, true},
		"severity":      {db.SortSeverity, true},
		"epss":          {db.SortEPSS, true},
		"cvss":          {db.SortCVSS, true},
		"package":       {db.SortPackage, false},
		"advisory":      {db.SortAdvisory, false},
		"target":        {db.SortTarget, false},
		"last_observed": {db.SortLastObserved, true},
	}
	for param, want := range accepted {
		store := &mockStore{findings: []db.Finding{}}
		w := doGet(t, store, "/api/projects/"+pid+"/findings?sort="+param)
		if w.Code != http.StatusOK {
			t.Fatalf("sort=%s status = %d, want 200; body = %s", param, w.Code, w.Body.String())
		}
		if store.findingParams.Sort != want.key {
			t.Errorf("sort=%s parsed as %q", param, store.findingParams.Sort)
		}
		if store.findingParams.SortDesc != want.desc {
			t.Errorf("sort=%s default descending = %v, want %v", param, store.findingParams.SortDesc, want.desc)
		}
	}

	for _, bad := range []string{"id", "cfs.last_score", "score", "package_name", "1"} {
		w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/findings?sort="+bad)
		if w.Code != http.StatusBadRequest {
			t.Errorf("sort=%s status = %d, want 400", bad, w.Code)
		}
		if code := errorCode(t, w); code != "invalid_sort" {
			t.Errorf("sort=%s error code = %q, want invalid_sort", bad, code)
		}
	}
}

func TestFindings_SortDefaultsToDecreeScoreDesc(t *testing.T) {
	t.Parallel()
	store := &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+uuid.New().String()+"/findings")
	if store.findingParams.Sort != db.SortDecreeScore || !store.findingParams.SortDesc {
		t.Errorf("default sort = %q desc=%v, want decree_score desc=true",
			store.findingParams.Sort, store.findingParams.SortDesc)
	}
}

func TestFindings_OrderParam(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()

	store := &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+pid+"/findings?sort=severity&order=asc")
	if store.findingParams.SortDesc {
		t.Error("order=asc must produce ascending")
	}

	store = &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+pid+"/findings?sort=package&order=desc")
	if !store.findingParams.SortDesc {
		t.Error("order=desc must produce descending")
	}

	for _, bad := range []string{"ASC", "ascending", "-1", "up"} {
		w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/findings?order="+bad)
		if w.Code != http.StatusBadRequest {
			t.Errorf("order=%s status = %d, want 400", bad, w.Code)
		}
		if code := errorCode(t, w); code != "invalid_order" {
			t.Errorf("order=%s error code = %q, want invalid_order", bad, code)
		}
	}

	// The `-key` form is deliberately not supported.
	w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/findings?sort=-severity")
	if w.Code != http.StatusBadRequest {
		t.Errorf("sort=-severity status = %d, want 400", w.Code)
	}
}

func TestFindings_SearchParam(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()

	store := &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+pid+"/findings?q=%20lodash%20")
	if store.findingParams.Query == nil || *store.findingParams.Query != "lodash" {
		t.Errorf("q was not trimmed and forwarded: %v", store.findingParams.Query)
	}

	store = &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+pid+"/findings?q=%20%20")
	if store.findingParams.Query != nil {
		t.Error("blank q must be ignored, not forwarded as an empty pattern")
	}

	w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/findings?q="+strings.Repeat("a", db.MaxSearchLength+1))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("oversized q status = %d, want 400", w.Code)
	}
	if code := errorCode(t, w); code != "invalid_query" {
		t.Errorf("oversized q error code = %q, want invalid_query", code)
	}

	store = &mockStore{findings: []db.Finding{}}
	w = doGet(t, store, "/api/projects/"+pid+"/findings?q="+strings.Repeat("a", db.MaxSearchLength))
	if w.Code != http.StatusOK {
		t.Errorf("q at the cap status = %d, want 200", w.Code)
	}
}

func TestFindings_CursorCarriesSortKey(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()
	observed := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC)
	severity := "high"
	store := &mockStore{
		findings: []db.Finding{{
			InstanceID: uuid.New(), PackageName: "lodash", AdvisoryID: "CVE-2024-0001",
			TargetName: "api", Severity: &severity, LastObservedAt: &observed,
		}},
		findingsMore: true,
	}

	w := doGet(t, store, "/api/projects/"+pid+"/findings?sort=severity&order=asc")
	var body PagedResponse[db.Finding]
	json.NewDecoder(w.Body).Decode(&body)
	if body.NextCursor == nil {
		t.Fatal("expected next_cursor")
	}

	// Same sort: the cursor is accepted and decoded.
	store2 := &mockStore{findings: []db.Finding{}}
	w = doGet(t, store2, "/api/projects/"+pid+"/findings?sort=severity&order=asc&cursor="+*body.NextCursor)
	if w.Code != http.StatusOK {
		t.Fatalf("matching cursor status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	if store2.findingParams.Cursor == nil {
		t.Fatal("cursor was not forwarded to the store")
	}
	if store2.findingParams.Cursor.Value != int32(3) {
		t.Errorf("cursor value = %#v, want severity rank 3", store2.findingParams.Cursor.Value)
	}

	// Different sort key, and different direction: both rejected.
	for _, path := range []string{
		"/api/projects/" + pid + "/findings?sort=package&cursor=" + *body.NextCursor,
		"/api/projects/" + pid + "/findings?sort=severity&order=desc&cursor=" + *body.NextCursor,
		"/api/projects/" + pid + "/findings?cursor=" + *body.NextCursor,
	} {
		w := doGet(t, &mockStore{}, path)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s status = %d, want 400", path, w.Code)
		}
		if code := errorCode(t, w); code != "cursor_sort_mismatch" {
			t.Errorf("%s error code = %q, want cursor_sort_mismatch", path, code)
		}
	}

	w = doGet(t, &mockStore{}, "/api/projects/"+pid+"/findings?cursor=not-base64!!")
	if w.Code != http.StatusBadRequest || errorCode(t, w) != "invalid_cursor" {
		t.Errorf("garbage cursor status = %d", w.Code)
	}
}

func TestFindings_CursorSurvivesSeparatorInTextValue(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()
	store := &mockStore{
		findings:     []db.Finding{{InstanceID: uuid.New(), PackageName: "we|ird|name"}},
		findingsMore: true,
	}
	w := doGet(t, store, "/api/projects/"+pid+"/findings?sort=package")
	var body PagedResponse[db.Finding]
	json.NewDecoder(w.Body).Decode(&body)
	if body.NextCursor == nil {
		t.Fatal("expected next_cursor")
	}

	next := &mockStore{findings: []db.Finding{}}
	w = doGet(t, next, "/api/projects/"+pid+"/findings?sort=package&cursor="+*body.NextCursor)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", w.Code, w.Body.String())
	}
	if next.findingParams.Cursor.Value != "we|ird|name" {
		t.Errorf("cursor value = %#v", next.findingParams.Cursor.Value)
	}
}

func TestFindings_FiltersStillForwarded(t *testing.T) {
	t.Parallel()
	store := &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+uuid.New().String()+
		"/findings?severity=CRITICAL&ecosystem=npm&min_epss=0.5&min_score=5&active_only=true&limit=7&sort=epss&q=lodash")

	p := store.findingParams
	if p.Severity == nil || *p.Severity != "critical" {
		t.Errorf("severity = %v, want lowercased critical", p.Severity)
	}
	if p.Ecosystem == nil || *p.Ecosystem != "npm" {
		t.Errorf("ecosystem = %v", p.Ecosystem)
	}
	if p.MinEPSS == nil || *p.MinEPSS != 0.5 {
		t.Errorf("min_epss = %v", p.MinEPSS)
	}
	if p.MinScore == nil || *p.MinScore != 5 {
		t.Errorf("min_score = %v", p.MinScore)
	}
	if !p.ActiveOnly || p.Limit != 7 || p.Sort != db.SortEPSS {
		t.Errorf("active_only/limit/sort = %v/%d/%s", p.ActiveOnly, p.Limit, p.Sort)
	}
	if p.Query == nil || *p.Query != "lodash" {
		t.Errorf("q = %v", p.Query)
	}
}

func TestGetProject(t *testing.T) {
	t.Parallel()
	id := uuid.New()

	w := doGet(t, &mockStore{project: &db.Project{ID: id, Name: "decree", CreatedAt: time.Now()}},
		"/api/projects/"+id.String())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	var body struct {
		Data db.Project `json:"data"`
	}
	json.NewDecoder(w.Body).Decode(&body)
	if body.Data.Name != "decree" || body.Data.ID != id {
		t.Errorf("data = %+v", body.Data)
	}

	w = doGet(t, &mockStore{project: nil}, "/api/projects/"+uuid.New().String())
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown project status = %d, want 404", w.Code)
	}
	if code := errorCode(t, w); code != "not_found" {
		t.Errorf("error code = %q, want not_found", code)
	}

	w = doGet(t, &mockStore{}, "/api/projects/not-a-uuid")
	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid uuid status = %d, want 400", w.Code)
	}
}

func TestGetFacets(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	store := &mockStore{facets: &db.Facets{
		Ecosystems:     []string{"alpine", "npm"},
		SeverityCounts: map[string]int{"critical": 2, "high": 1, "medium": 0, "low": 0, "unknown": 3},
		Total:          6,
	}}

	w := doGet(t, store, "/api/projects/"+id.String()+"/facets")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	var body struct {
		Data db.Facets `json:"data"`
	}
	json.NewDecoder(w.Body).Decode(&body)
	if len(body.Data.Ecosystems) != 2 || body.Data.Ecosystems[0] != "alpine" {
		t.Errorf("ecosystems = %v", body.Data.Ecosystems)
	}
	if body.Data.SeverityCounts["critical"] != 2 || body.Data.SeverityCounts["unknown"] != 3 {
		t.Errorf("severity_counts = %v", body.Data.SeverityCounts)
	}
	if body.Data.Total != 6 {
		t.Errorf("total = %d, want 6", body.Data.Total)
	}
	if store.facetsActive {
		t.Error("active_only must default to false")
	}

	store = &mockStore{facets: &db.Facets{}}
	doGet(t, store, "/api/projects/"+id.String()+"/facets?active_only=true")
	if !store.facetsActive {
		t.Error("active_only=true was not forwarded")
	}

	// Facets ignore the caller's other filters by construction.
	store = &mockStore{facets: &db.Facets{}}
	w = doGet(t, store, "/api/projects/"+id.String()+"/facets?ecosystem=npm&severity=critical&q=lodash")
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}

	w = doGet(t, &mockStore{}, "/api/projects/not-a-uuid/facets")
	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid uuid status = %d, want 400", w.Code)
	}
}

// min_score is a risk floor on the DECREE Score, which ADR-0035 fixed to 0-10.
func TestFindings_MinScoreParam(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()

	for _, tc := range []struct {
		param string
		want  float32
	}{{"5", 5}, {"6.5", 6.5}, {"0", 0}, {"10", 10}} {
		store := &mockStore{findings: []db.Finding{}}
		w := doGet(t, store, "/api/projects/"+pid+"/findings?min_score="+tc.param)
		if w.Code != http.StatusOK {
			t.Fatalf("min_score=%s status = %d, want 200; body = %s", tc.param, w.Code, w.Body.String())
		}
		if store.findingParams.MinScore == nil || *store.findingParams.MinScore != tc.want {
			t.Errorf("min_score=%s forwarded as %v, want %v",
				tc.param, store.findingParams.MinScore, tc.want)
		}
	}

	// Unlike min_epss, an unusable value is rejected: a silently ignored risk
	// floor shows the caller more findings than they asked to see.
	for _, bad := range []string{"abc", "-1", "10.1", "11", "NaN", "Inf", ""} {
		w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/findings?min_score="+bad)
		if w.Code != http.StatusBadRequest {
			t.Errorf("min_score=%q status = %d, want 400", bad, w.Code)
			continue
		}
		if code := errorCode(t, w); code != "invalid_min_score" {
			t.Errorf("min_score=%q error code = %q, want invalid_min_score", bad, code)
		}
	}

	// Absent means unfiltered, not zero.
	store := &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+pid+"/findings")
	if store.findingParams.MinScore != nil {
		t.Errorf("min_score defaulted to %v, want nil", store.findingParams.MinScore)
	}
}
