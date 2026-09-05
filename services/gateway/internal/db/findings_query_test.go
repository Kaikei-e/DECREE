package db

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseSortKey(t *testing.T) {
	t.Parallel()
	for _, s := range SortKeys() {
		if _, ok := ParseSortKey(s); !ok {
			t.Errorf("ParseSortKey(%q) rejected a whitelisted key", s)
		}
	}
	for _, s := range []string{"", "id", "cfs.last_score", "decree_score; DROP TABLE scans", "DECREE_SCORE"} {
		if _, ok := ParseSortKey(s); ok {
			t.Errorf("ParseSortKey(%q) accepted a non-whitelisted key", s)
		}
	}
}

func TestSortKeyDefaultDirection(t *testing.T) {
	t.Parallel()
	desc := map[SortKey]bool{
		SortDecreeScore: true, SortSeverity: true, SortEPSS: true,
		SortCVSS: true, SortLastObserved: true,
		SortPackage: false, SortAdvisory: false, SortTarget: false,
	}
	for key, want := range desc {
		if got := key.DefaultDescending(); got != want {
			t.Errorf("%s default descending = %v, want %v", key, got, want)
		}
	}
}

// The keyset predicate is only correct while it mirrors the ORDER BY it pages
// through; assert both are derived from the same expression and direction.
func TestBuildFindingsQuery_OrderByAndCursorAgree(t *testing.T) {
	t.Parallel()
	for _, key := range sortKeyOrder {
		for _, desc := range []bool{true, false} {
			col := findingSortColumns[key]
			expr := sortExpression(col.expr)
			params := FindingParams{
				FindingFilters: FindingFilters{ProjectID: uuid.New()},
				Sort:           key,
				SortDesc:       desc,
				Limit:          10,
				Cursor:         &FindingCursor{Sort: key, Desc: desc, Value: int32(0), InstanceID: uuid.New()},
			}
			query, _ := buildFindingsQuery(params, findingsFrom)

			direction := "ASC"
			op := ">"
			if desc {
				direction = "DESC"
				op = "<"
			}
			wantOrder := "ORDER BY " + expr + " " + direction + ", vi.id " + direction
			if !strings.Contains(query, wantOrder) {
				t.Errorf("%s/%s: missing %q\n%s", key, direction, wantOrder, query)
			}
			wantCursor := "(" + expr + ", vi.id) " + op + " ("
			if !strings.Contains(query, wantCursor) {
				t.Errorf("%s/%s: missing %q\n%s", key, direction, wantCursor, query)
			}
		}
	}
}

func TestBuildFindingsQuery_UnknownSortFallsBackToDefault(t *testing.T) {
	t.Parallel()
	params := FindingParams{
		FindingFilters: FindingFilters{ProjectID: uuid.New()},
		Sort:           SortKey("nonsense"),
		Limit:          10,
	}
	query, _ := buildFindingsQuery(params, findingsFrom)
	if !strings.Contains(query, "ORDER BY COALESCE(cfs.last_score, 0)") {
		t.Errorf("unknown sort key did not fall back to the default:\n%s", query)
	}
	if strings.Contains(query, "nonsense") {
		t.Error("unknown sort key leaked into the SQL")
	}
}

func TestBuildFindingsQuery_SearchIsBoundNotInterpolated(t *testing.T) {
	t.Parallel()
	q := "lodash'); DROP TABLE scans;--"
	params := FindingParams{FindingFilters: FindingFilters{ProjectID: uuid.New(), Query: &q}, Limit: 10}
	query, args := buildFindingsQuery(params, findingsFrom)

	if strings.Contains(query, "DROP TABLE") {
		t.Fatalf("search text was interpolated into the SQL:\n%s", query)
	}
	if !strings.Contains(query, "vi.package_name ILIKE") ||
		!strings.Contains(query, "vi.advisory_id ILIKE") ||
		!strings.Contains(query, "t.name ILIKE") {
		t.Errorf("search does not cover package, advisory and target:\n%s", query)
	}
	found := false
	for _, a := range args {
		if s, ok := a.(string); ok && strings.Contains(s, "DROP TABLE") {
			found = true
			if !strings.HasPrefix(s, "%") || !strings.HasSuffix(s, "%") {
				t.Errorf("search arg is not a contains pattern: %q", s)
			}
		}
	}
	if !found {
		t.Error("search text was not passed as a bound parameter")
	}
}

func TestEscapeLike(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"lodash":   "lodash",
		"100%":     `100\%`,
		"a_b":      `a\_b`,
		`back\sla`: `back\\sla`,
		`%_\`:      `\%\_\\`,
	}
	for in, want := range cases {
		if got := escapeLike(in); got != want {
			t.Errorf("escapeLike(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSortValueRoundTrip(t *testing.T) {
	t.Parallel()
	score := float32(8.25)
	epss := float32(0.9137)
	cvss := float32(7.5)
	severity := "CRITICAL"
	observed := time.Date(2026, 3, 4, 5, 6, 7, 890123000, time.UTC)
	f := Finding{
		InstanceID: uuid.New(), TargetName: "api|edge", PackageName: "lo|dash",
		AdvisoryID: "CVE-2024-0001", Severity: &severity, DecreeScore: &score,
		EPSSScore: &epss, CVSSScore: &cvss, LastObservedAt: &observed,
	}

	want := map[SortKey]any{
		SortDecreeScore:  score,
		SortSeverity:     int32(4),
		SortEPSS:         epss,
		SortCVSS:         cvss,
		SortPackage:      "lo|dash",
		SortAdvisory:     "CVE-2024-0001",
		SortTarget:       "api|edge",
		SortLastObserved: observed,
	}
	for key, expected := range want {
		got, err := ParseSortValue(key, FormatSortValue(key, f))
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		if key == SortLastObserved {
			if !got.(time.Time).Equal(expected.(time.Time)) {
				t.Errorf("%s = %v, want %v", key, got, expected)
			}
			continue
		}
		if got != expected {
			t.Errorf("%s = %#v, want %#v", key, got, expected)
		}
	}
}

func TestSortValueNullsUseSentinels(t *testing.T) {
	t.Parallel()
	empty := Finding{}
	for key, want := range map[SortKey]string{
		SortDecreeScore:  "0",
		SortSeverity:     "0",
		SortEPSS:         "0",
		SortCVSS:         "0",
		SortLastObserved: "0001-01-01T00:00:00Z",
	} {
		if got := FormatSortValue(key, empty); got != want {
			t.Errorf("%s sentinel = %q, want %q", key, got, want)
		}
	}
}

func TestSeverityRankIsCaseInsensitive(t *testing.T) {
	t.Parallel()
	for _, s := range []string{"critical", "CRITICAL", "Critical"} {
		if got := severityRank(&s); got != 4 {
			t.Errorf("severityRank(%q) = %d, want 4", s, got)
		}
	}
	unknown := "unknown"
	if severityRank(&unknown) != 0 || severityRank(nil) != 0 {
		t.Error("unknown and NULL severities must rank 0")
	}
}

// The facets endpoint counts a NULL last_severity as "unknown", so the filter
// has to select those rows too or the facet count is unreachable.
func TestBuildFindingsQuery_UnknownSeverityIncludesNulls(t *testing.T) {
	t.Parallel()
	unknown := "unknown"
	query, _ := buildFindingsQuery(
		FindingParams{FindingFilters: FindingFilters{ProjectID: uuid.New(), Severity: &unknown}, Limit: 10},
		findingsFrom)
	if !strings.Contains(query, "cfs.last_severity IS NULL") {
		t.Errorf("severity=unknown must also match NULL:\n%s", query)
	}

	critical := "critical"
	query, _ = buildFindingsQuery(
		FindingParams{FindingFilters: FindingFilters{ProjectID: uuid.New(), Severity: &critical}, Limit: 10},
		findingsFrom)
	if strings.Contains(query, "IS NULL") {
		t.Errorf("severity=critical must stay an exact match:\n%s", query)
	}
}

// The advisory filter is how the UI expands one group back into its instances.
func TestBuildFindingsQuery_AdvisoryFilterIsExact(t *testing.T) {
	t.Parallel()
	advisory := "CVE-2021-44228"
	query, args := buildFindingsQuery(
		FindingParams{FindingFilters: FindingFilters{ProjectID: uuid.New(), Advisory: &advisory}, Limit: 10},
		findingsFrom)

	if !strings.Contains(query, "vi.advisory_id = $") {
		t.Errorf("advisory filter must be an exact match:\n%s", query)
	}
	if strings.Contains(query, advisory) {
		t.Errorf("advisory was interpolated into the SQL:\n%s", query)
	}
	found := false
	for _, a := range args {
		if s, ok := a.(string); ok && s == advisory {
			found = true
		}
	}
	if !found {
		t.Error("advisory was not passed as a bound parameter")
	}
}
