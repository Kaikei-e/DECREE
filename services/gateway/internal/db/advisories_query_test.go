package db

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseAdvisorySortKey(t *testing.T) {
	t.Parallel()
	for _, s := range AdvisorySortKeys() {
		if _, ok := ParseAdvisorySortKey(s); !ok {
			t.Errorf("ParseAdvisorySortKey(%q) rejected a whitelisted key", s)
		}
	}
	// package and target are per-instance columns; they have no group-level meaning.
	for _, s := range []string{"", "package", "target", "id", "vi.advisory_id", "INSTANCE_COUNT"} {
		if _, ok := ParseAdvisorySortKey(s); ok {
			t.Errorf("ParseAdvisorySortKey(%q) accepted a non-whitelisted key", s)
		}
	}
}

func TestAdvisorySortKeyDefaultDirection(t *testing.T) {
	t.Parallel()
	desc := map[SortKey]bool{
		SortDecreeScore: true, SortSeverity: true, SortEPSS: true, SortCVSS: true,
		SortInstanceCount: true, SortLastObserved: true, SortAdvisory: false,
	}
	for key, want := range desc {
		if got := AdvisoryDefaultDescending(key); got != want {
			t.Errorf("%s default descending = %v, want %v", key, got, want)
		}
	}
}

// The group keyset lives in HAVING because it compares aggregates; it is only
// correct while it mirrors the ORDER BY, tie-broken on the grouping column.
func TestBuildAdvisoriesQuery_OrderByAndCursorAgree(t *testing.T) {
	t.Parallel()
	for _, key := range advisorySortKeyOrder {
		for _, desc := range []bool{true, false} {
			expr := sortExpression(advisorySortColumns[key].expr)
			params := AdvisoryParams{
				FindingFilters: FindingFilters{ProjectID: uuid.New()},
				Sort:           key,
				SortDesc:       desc,
				Limit:          10,
				Cursor:         &AdvisoryCursor{Sort: key, Desc: desc, Value: int32(0), AdvisoryID: "CVE-2024-0001"},
			}
			query, _ := buildAdvisoriesQuery(params, advisoriesFrom)

			direction, op := "ASC", ">"
			if desc {
				direction, op = "DESC", "<"
			}
			wantOrder := "ORDER BY " + expr + " " + direction + ", vi.advisory_id " + direction
			if !strings.Contains(query, wantOrder) {
				t.Errorf("%s/%s: missing %q\n%s", key, direction, wantOrder, query)
			}
			wantCursor := "HAVING (" + expr + ", vi.advisory_id) " + op + " ("
			if !strings.Contains(query, wantCursor) {
				t.Errorf("%s/%s: missing %q\n%s", key, direction, wantCursor, query)
			}
		}
	}
}

func TestBuildAdvisoriesQuery_GroupsAndCapsNameLists(t *testing.T) {
	t.Parallel()
	query, _ := buildAdvisoriesQuery(
		AdvisoryParams{FindingFilters: FindingFilters{ProjectID: uuid.New()}, Limit: 10}, advisoriesFrom)

	if !strings.Contains(query, "GROUP BY vi.advisory_id") {
		t.Errorf("query does not group by advisory:\n%s", query)
	}
	if strings.Contains(query, "HAVING") {
		t.Errorf("a cursorless query must not emit HAVING:\n%s", query)
	}
	if !strings.Contains(query, "count(DISTINCT vi.target_id)") {
		t.Errorf("target_count must be a true distinct count:\n%s", query)
	}
	for _, col := range []string{"t.name", "vi.package_name", "vi.ecosystem"} {
		want := "(array_agg(DISTINCT " + col + " ORDER BY " + col + "))[1:5]"
		if !strings.Contains(query, want) {
			t.Errorf("missing capped distinct list %q:\n%s", want, query)
		}
	}
}

func TestBuildAdvisoriesQuery_UnknownSortFallsBackToDefault(t *testing.T) {
	t.Parallel()
	params := AdvisoryParams{
		FindingFilters: FindingFilters{ProjectID: uuid.New()},
		Sort:           SortKey("package"),
		Limit:          10,
	}
	query, _ := buildAdvisoriesQuery(params, advisoriesFrom)
	if !strings.Contains(query, "ORDER BY COALESCE(MAX(cfs.last_score), 0)") {
		t.Errorf("unknown sort key did not fall back to the default:\n%s", query)
	}
	if strings.Contains(query, "vi.package_name)\n") {
		t.Errorf("unknown sort key leaked into the ORDER BY:\n%s", query)
	}
}

// Both listings must filter the same instance set, so the WHERE clauses they
// build from identical filters have to be identical too.
func TestBuildAdvisoriesQuery_SharesFindingFilters(t *testing.T) {
	t.Parallel()
	q := "lodash'); DROP TABLE scans;--"
	severity := "unknown"
	ecosystem := "npm"
	advisory := "CVE-2024-0001"
	minEPSS := float32(0.25)
	minScore := float32(5)
	filters := FindingFilters{
		ProjectID: uuid.New(), Severity: &severity, Ecosystem: &ecosystem,
		MinEPSS: &minEPSS, MinScore: &minScore, Advisory: &advisory, Query: &q, ActiveOnly: true,
	}

	findingsQuery, findingsArgs := buildFindingsQuery(
		FindingParams{FindingFilters: filters, Limit: 10}, findingsFrom)
	advisoriesQuery, advisoriesArgs := buildAdvisoriesQuery(
		AdvisoryParams{FindingFilters: filters, Limit: 10}, advisoriesFrom)

	where := func(query string) string {
		_, rest, _ := strings.Cut(query, "WHERE ")
		clause, _, _ := strings.Cut(rest, "\n\t\t")
		return clause
	}
	if where(findingsQuery) != where(advisoriesQuery) {
		t.Errorf("filter clauses diverged\nfindings:   %s\nadvisories: %s",
			where(findingsQuery), where(advisoriesQuery))
	}
	if strings.Contains(advisoriesQuery, "DROP TABLE") {
		t.Fatalf("search text was interpolated into the SQL:\n%s", advisoriesQuery)
	}
	// The limit is the only extra argument, so the filters bound identically.
	if len(advisoriesArgs) != len(findingsArgs) {
		t.Errorf("bound args = %d, want %d", len(advisoriesArgs), len(findingsArgs))
	}
}

func TestAdvisorySortValueRoundTrip(t *testing.T) {
	t.Parallel()
	score := float32(8.66)
	epss := float32(0.97425)
	cvss := float32(10)
	severity := "critical"
	observed := time.Date(2026, 9, 4, 22, 46, 52, 123456000, time.UTC)
	g := AdvisoryGroup{
		AdvisoryID: "CVE-2021-44228", Severity: &severity, MaxDecreeScore: &score,
		EPSSScore: &epss, CVSSScore: &cvss, InstanceCount: 7, LastObservedAt: &observed,
	}

	want := map[SortKey]any{
		SortDecreeScore:   score,
		SortSeverity:      int32(4),
		SortEPSS:          epss,
		SortCVSS:          cvss,
		SortAdvisory:      "CVE-2021-44228",
		SortInstanceCount: int64(7),
		SortLastObserved:  observed,
	}
	for key, expected := range want {
		got, err := ParseAdvisorySortValue(key, FormatAdvisorySortValue(key, g))
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

	if _, err := ParseAdvisorySortValue(SortPackage, "lodash"); err == nil {
		t.Error("ParseAdvisorySortValue accepted a key outside the advisory whitelist")
	}
}

func TestAdvisorySortValueNullsUseSentinels(t *testing.T) {
	t.Parallel()
	empty := AdvisoryGroup{}
	for key, want := range map[SortKey]string{
		SortDecreeScore:   "0",
		SortSeverity:      "0",
		SortEPSS:          "0",
		SortCVSS:          "0",
		SortInstanceCount: "0",
		SortLastObserved:  "0001-01-01T00:00:00Z",
	} {
		if got := FormatAdvisorySortValue(key, empty); got != want {
			t.Errorf("%s sentinel = %q, want %q", key, got, want)
		}
	}
}
