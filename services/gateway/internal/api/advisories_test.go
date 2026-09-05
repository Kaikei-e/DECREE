package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/google/uuid"
)

func TestAdvisories_SortWhitelist(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()

	accepted := map[string]struct {
		key  db.SortKey
		desc bool
	}{
		"decree_score":   {db.SortDecreeScore, true},
		"severity":       {db.SortSeverity, true},
		"epss":           {db.SortEPSS, true},
		"cvss":           {db.SortCVSS, true},
		"advisory":       {db.SortAdvisory, false},
		"instance_count": {db.SortInstanceCount, true},
		"last_observed":  {db.SortLastObserved, true},
	}
	for param, want := range accepted {
		store := &mockStore{advisories: []db.AdvisoryGroup{}}
		w := doGet(t, store, "/api/projects/"+pid+"/advisories?sort="+param)
		if w.Code != http.StatusOK {
			t.Fatalf("sort=%s status = %d, want 200; body = %s", param, w.Code, w.Body.String())
		}
		if store.advisoryParams.Sort != want.key {
			t.Errorf("sort=%s parsed as %q", param, store.advisoryParams.Sort)
		}
		if store.advisoryParams.SortDesc != want.desc {
			t.Errorf("sort=%s default descending = %v, want %v",
				param, store.advisoryParams.SortDesc, want.desc)
		}
	}

	// package and target sort per-instance columns that no longer exist here.
	for _, bad := range []string{"package", "target", "id", "count", "-severity"} {
		w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/advisories?sort="+bad)
		if w.Code != http.StatusBadRequest {
			t.Errorf("sort=%s status = %d, want 400", bad, w.Code)
		}
		if code := errorCode(t, w); code != "invalid_sort" {
			t.Errorf("sort=%s error code = %q, want invalid_sort", bad, code)
		}
	}

	store := &mockStore{advisories: []db.AdvisoryGroup{}}
	doGet(t, store, "/api/projects/"+pid+"/advisories")
	if store.advisoryParams.Sort != db.SortDecreeScore || !store.advisoryParams.SortDesc {
		t.Errorf("default sort = %q desc=%v, want decree_score desc=true",
			store.advisoryParams.Sort, store.advisoryParams.SortDesc)
	}

	for _, bad := range []string{"ASC", "ascending", "up"} {
		w := doGet(t, &mockStore{}, "/api/projects/"+pid+"/advisories?order="+bad)
		if code := errorCode(t, w); w.Code != http.StatusBadRequest || code != "invalid_order" {
			t.Errorf("order=%s status = %d code = %q", bad, w.Code, code)
		}
	}
}

func TestAdvisories_FiltersForwarded(t *testing.T) {
	t.Parallel()
	store := &mockStore{advisories: []db.AdvisoryGroup{}}
	doGet(t, store, "/api/projects/"+uuid.New().String()+
		"/advisories?severity=CRITICAL&ecosystem=Maven&min_epss=0.5&active_only=true&limit=7&q=log4j")

	p := store.advisoryParams
	if p.Severity == nil || *p.Severity != "critical" {
		t.Errorf("severity = %v, want lowercased critical", p.Severity)
	}
	if p.Ecosystem == nil || *p.Ecosystem != "Maven" {
		t.Errorf("ecosystem = %v", p.Ecosystem)
	}
	if p.MinEPSS == nil || *p.MinEPSS != 0.5 {
		t.Errorf("min_epss = %v", p.MinEPSS)
	}
	if !p.ActiveOnly || p.Limit != 7 {
		t.Errorf("active_only/limit = %v/%d", p.ActiveOnly, p.Limit)
	}
	if p.Query == nil || *p.Query != "log4j" {
		t.Errorf("q = %v", p.Query)
	}

	w := doGet(t, &mockStore{}, "/api/projects/not-a-uuid/advisories")
	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid uuid status = %d, want 400", w.Code)
	}
}

func TestAdvisories_CursorCarriesSortKey(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()
	store := &mockStore{
		advisories:     []db.AdvisoryGroup{{AdvisoryID: "CVE-2021-44228", InstanceCount: 9}},
		advisoriesMore: true,
	}

	w := doGet(t, store, "/api/projects/"+pid+"/advisories?sort=instance_count&order=asc")
	var body PagedResponse[db.AdvisoryGroup]
	json.NewDecoder(w.Body).Decode(&body)
	if body.NextCursor == nil {
		t.Fatal("expected next_cursor")
	}

	next := &mockStore{advisories: []db.AdvisoryGroup{}}
	w = doGet(t, next, "/api/projects/"+pid+"/advisories?sort=instance_count&order=asc&cursor="+*body.NextCursor)
	if w.Code != http.StatusOK {
		t.Fatalf("matching cursor status = %d, want 200; body = %s", w.Code, w.Body.String())
	}
	if next.advisoryParams.Cursor == nil {
		t.Fatal("cursor was not forwarded to the store")
	}
	if next.advisoryParams.Cursor.Value != int64(9) {
		t.Errorf("cursor value = %#v, want instance count 9", next.advisoryParams.Cursor.Value)
	}
	if next.advisoryParams.Cursor.AdvisoryID != "CVE-2021-44228" {
		t.Errorf("cursor tie-break = %q", next.advisoryParams.Cursor.AdvisoryID)
	}

	for _, path := range []string{
		"/api/projects/" + pid + "/advisories?sort=severity&cursor=" + *body.NextCursor,
		"/api/projects/" + pid + "/advisories?sort=instance_count&order=desc&cursor=" + *body.NextCursor,
		"/api/projects/" + pid + "/advisories?cursor=" + *body.NextCursor,
	} {
		w := doGet(t, &mockStore{}, path)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s status = %d, want 400", path, w.Code)
		}
		if code := errorCode(t, w); code != "cursor_sort_mismatch" {
			t.Errorf("%s error code = %q, want cursor_sort_mismatch", path, code)
		}
	}

	w = doGet(t, &mockStore{}, "/api/projects/"+pid+"/advisories?cursor=not-base64!!")
	if w.Code != http.StatusBadRequest || errorCode(t, w) != "invalid_cursor" {
		t.Errorf("garbage cursor status = %d", w.Code)
	}

	// A findings cursor names a tie-break the grouped endpoint cannot use.
	findings := &mockStore{findings: []db.Finding{{InstanceID: uuid.New()}}, findingsMore: true}
	w = doGet(t, findings, "/api/projects/"+pid+"/findings?sort=decree_score")
	var findingsBody PagedResponse[db.Finding]
	json.NewDecoder(w.Body).Decode(&findingsBody)
	w = doGet(t, &mockStore{}, "/api/projects/"+pid+"/advisories?cursor="+*findingsBody.NextCursor)
	if w.Code != http.StatusBadRequest {
		t.Errorf("findings cursor accepted by /advisories: status = %d", w.Code)
	}
}

// The advisory sort's tie-break is the sort value, so the cursor must survive an
// id that contains the field separator.
func TestAdvisories_CursorSurvivesSeparatorInAdvisoryID(t *testing.T) {
	t.Parallel()
	pid := uuid.New().String()
	store := &mockStore{
		advisories:     []db.AdvisoryGroup{{AdvisoryID: "CVE|2021|44228"}},
		advisoriesMore: true,
	}
	w := doGet(t, store, "/api/projects/"+pid+"/advisories?sort=advisory")
	var body PagedResponse[db.AdvisoryGroup]
	json.NewDecoder(w.Body).Decode(&body)
	if body.NextCursor == nil {
		t.Fatal("expected next_cursor")
	}

	next := &mockStore{advisories: []db.AdvisoryGroup{}}
	w = doGet(t, next, "/api/projects/"+pid+"/advisories?sort=advisory&cursor="+*body.NextCursor)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", w.Code, w.Body.String())
	}
	c := next.advisoryParams.Cursor
	if c.AdvisoryID != "CVE|2021|44228" || c.Value != "CVE|2021|44228" {
		t.Errorf("cursor = %#v", c)
	}
}

func TestAdvisories_ResponseShape(t *testing.T) {
	t.Parallel()
	first := time.Date(2026, 6, 8, 2, 11, 0, 0, time.UTC)
	last := time.Date(2026, 9, 4, 22, 46, 52, 0, time.UTC)
	score, epss, cvss := float32(8.66), float32(0.97425), float32(10)
	severity := "critical"

	store := &mockStore{advisories: []db.AdvisoryGroup{{
		AdvisoryID: "CVE-2021-44228", Severity: &severity, MaxDecreeScore: &score,
		EPSSScore: &epss, CVSSScore: &cvss, InstanceCount: 7, TargetCount: 4,
		TargetNames:  []string{"helios-legacy-admin", "helios-payments-service"},
		PackageNames: []string{"org.apache.logging.log4j:log4j-core"},
		Ecosystems:   []string{"Maven"}, IsActive: true,
		FirstObservedAt: &first, LastObservedAt: &last,
	}}}

	w := doGet(t, store, "/api/projects/"+uuid.New().String()+"/advisories")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", w.Code, w.Body.String())
	}

	var body struct {
		Data    []map[string]any `json:"data"`
		HasMore bool             `json:"has_more"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("data = %v", body.Data)
	}
	got := body.Data[0]
	want := map[string]any{
		"advisory_id":       "CVE-2021-44228",
		"severity":          "critical",
		"max_decree_score":  8.66,
		"epss_score":        0.97425,
		"cvss_score":        float64(10),
		"instance_count":    float64(7),
		"target_count":      float64(4),
		"is_active":         true,
		"first_observed_at": "2026-06-08T02:11:00Z",
		"last_observed_at":  "2026-09-04T22:46:52Z",
	}
	for k, v := range want {
		if f, ok := v.(float64); ok {
			if g, ok := got[k].(float64); !ok || abs(g-f) > 1e-4 {
				t.Errorf("%s = %#v, want %v", k, got[k], v)
			}
			continue
		}
		if got[k] != v {
			t.Errorf("%s = %#v, want %#v", k, got[k], v)
		}
	}
	for _, k := range []string{"target_names", "package_names", "ecosystems"} {
		if _, ok := got[k].([]any); !ok {
			t.Errorf("%s = %#v, want an array", k, got[k])
		}
	}
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func TestFindings_AdvisoryFilter(t *testing.T) {
	t.Parallel()
	store := &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+uuid.New().String()+
		"/findings?advisory=CVE-2021-44228&severity=critical&limit=3")

	p := store.findingParams
	if p.Advisory == nil || *p.Advisory != "CVE-2021-44228" {
		t.Errorf("advisory = %v", p.Advisory)
	}
	if p.Severity == nil || *p.Severity != "critical" || p.Limit != 3 {
		t.Errorf("advisory filter did not compose with the other params: %+v", p)
	}

	store = &mockStore{findings: []db.Finding{}}
	doGet(t, store, "/api/projects/"+uuid.New().String()+"/findings?advisory=%20%20")
	if store.findingParams.Advisory != nil {
		t.Error("blank advisory must be ignored, not forwarded as an empty match")
	}
}
