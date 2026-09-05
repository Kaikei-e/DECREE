//go:build integration

package db

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Groups that exercise the aggregation rules: a mixed-severity advisory spread
// over two targets with a NULL-everything instance, an advisory whose instances
// are all NULL, and one wide enough to hit the name cap.
var advisoryFixture = []fixtureRow{
	{"22222222-0000-0000-0000-000000000001", "left-pad", "1.0.0", "npm", "CVE-9000-0001", "high", "5.0", "0.5", "", "7.5", true, "2026-03-01T00:00:00Z", "api"},
	{"22222222-0000-0000-0000-000000000002", "left-pad", "2.0.0", "npm", "CVE-9000-0001", "critical", "9.9", "", "0.5", "9.8", false, "2026-03-05T00:00:00Z", "web"},
	{"22222222-0000-0000-0000-000000000003", "left-pad", "3.0.0", "npm", "CVE-9000-0001", "", "", "", "", "", false, "", "api"},
	{"22222222-0000-0000-0000-000000000004", "nullpkg", "1.0.0", "cargo", "CVE-9000-0002", "", "", "", "", "", false, "", "api"},
	{"22222222-0000-0000-0000-000000000005", "widecast", "1.0.0", "gem", "CVE-9000-0003", "low", "1.0", "", "", "3.1", true, "2026-03-02T00:00:00Z", "t-1"},
	{"22222222-0000-0000-0000-000000000006", "widecast", "1.0.0", "gem", "CVE-9000-0003", "low", "1.0", "", "", "3.1", true, "2026-03-02T00:00:00Z", "t-2"},
	{"22222222-0000-0000-0000-000000000007", "widecast", "1.0.0", "gem", "CVE-9000-0003", "low", "1.0", "", "", "3.1", true, "2026-03-02T00:00:00Z", "t-3"},
	{"22222222-0000-0000-0000-000000000008", "widecast", "1.0.0", "gem", "CVE-9000-0003", "low", "1.0", "", "", "3.1", true, "2026-03-02T00:00:00Z", "t-4"},
	{"22222222-0000-0000-0000-000000000009", "widecast", "1.0.0", "gem", "CVE-9000-0003", "low", "1.0", "", "", "3.1", true, "2026-03-02T00:00:00Z", "t-5"},
	{"22222222-0000-0000-0000-00000000000a", "widecast", "1.0.0", "gem", "CVE-9000-0003", "low", "1.0", "", "", "3.1", true, "2026-03-02T00:00:00Z", "t-6"},
}

// advisoryFixtureFrom extends the findings fixture with the first-observation
// lateral that the grouped query aggregates over.
func advisoryFixtureFrom(rows []fixtureRow) string {
	return fixtureFrom(rows) + `
	CROSS JOIN LATERAL (SELECT f.last_observed_at - interval '10 days' AS observed_at) first_vo
`
}

func queryAdvisoryFixture(t *testing.T, store *PgStore, params AdvisoryParams, from string) ([]AdvisoryGroup, bool) {
	t.Helper()
	query, args := buildAdvisoriesQuery(params, from)
	rows, err := store.pool.Query(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("query: %v\n%s", err, query)
	}
	groups, err := pgx.CollectRows(rows, scanAdvisoryGroup)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	hasMore := len(groups) > params.Limit
	if hasMore {
		groups = groups[:params.Limit]
	}
	return groups, hasMore
}

func advisoryIDs(groups []AdvisoryGroup) []string {
	out := make([]string, 0, len(groups))
	for _, g := range groups {
		out = append(out, g.AdvisoryID)
	}
	return out
}

func TestListAdvisories_KeysetPaginationCoversEveryGroupOnce(t *testing.T) {
	store := testPool(t)
	fixture := append(append([]fixtureRow{}, keysetFixture...), advisoryFixture...)

	distinct := map[string]bool{}
	for _, r := range fixture {
		distinct[r.advisoryID] = true
	}

	assertPagesEveryGroupOnce(t, store, advisoryFixtureFrom(fixture),
		FindingFilters{ProjectID: uuid.MustParse(fixtureProjectID)}, distinct)
}

// The keyset lives in HAVING and pages over groups that a WHERE filter has already
// narrowed, so it has to stay exact once instances drop out before the aggregation.
func TestListAdvisories_MinScoreKeysetPaginationCoversEveryGroupOnce(t *testing.T) {
	store := testPool(t)
	fixture := append(append([]fixtureRow{}, keysetFixture...), advisoryFixture...)
	minScore := float32(5)

	distinct := map[string]bool{}
	for _, r := range fixture {
		if v, err := strconv.ParseFloat(r.score, 32); err == nil && v >= 5 {
			distinct[r.advisoryID] = true
		}
	}
	if len(distinct) < 4 {
		t.Fatalf("fixture leaves only %d groups above the threshold; too few to page", len(distinct))
	}

	assertPagesEveryGroupOnce(t, store, advisoryFixtureFrom(fixture),
		FindingFilters{ProjectID: uuid.MustParse(fixtureProjectID), MinScore: &minScore}, distinct)
}

func assertPagesEveryGroupOnce(t *testing.T, store *PgStore, from string, filters FindingFilters, distinct map[string]bool) {
	t.Helper()
	for _, key := range advisorySortKeyOrder {
		for _, desc := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s_%v", key, desc), func(t *testing.T) {
				base := AdvisoryParams{
					FindingFilters: filters,
					Sort:           key,
					SortDesc:       desc,
				}

				unpaged := base
				unpaged.Limit = len(distinct) + 10
				want, _ := queryAdvisoryFixture(t, store, unpaged, from)
				if len(want) != len(distinct) {
					t.Fatalf("unpaged returned %d groups, want %d", len(want), len(distinct))
				}

				var got []AdvisoryGroup
				page := base
				page.Limit = 3
				for i := 0; ; i++ {
					if i > len(distinct)+5 {
						t.Fatalf("pagination did not terminate; collected %d groups", len(got))
					}
					rows, hasMore := queryAdvisoryFixture(t, store, page, from)
					got = append(got, rows...)
					if !hasMore {
						break
					}
					last := rows[len(rows)-1]
					value, err := ParseAdvisorySortValue(key, FormatAdvisorySortValue(key, last))
					if err != nil {
						t.Fatalf("cursor value round-trip: %v", err)
					}
					page.Cursor = &AdvisoryCursor{
						Sort: key, Desc: desc, Value: value, AdvisoryID: last.AdvisoryID,
					}
				}

				gotIDs, wantIDs := advisoryIDs(got), advisoryIDs(want)
				seen := map[string]int{}
				for _, id := range gotIDs {
					seen[id]++
				}
				for id, n := range seen {
					if n > 1 {
						t.Errorf("group %s returned %d times", id, n)
					}
				}
				for id := range distinct {
					if seen[id] == 0 {
						t.Errorf("group %s never returned", id)
					}
				}
				if strings.Join(gotIDs, ",") != strings.Join(wantIDs, ",") {
					t.Errorf("paged order\n got: %v\nwant: %v", gotIDs, wantIDs)
				}
			})
		}
	}
}

func TestListAdvisories_AggregationSemantics(t *testing.T) {
	store := testPool(t)
	from := advisoryFixtureFrom(advisoryFixture)
	params := AdvisoryParams{
		FindingFilters: FindingFilters{ProjectID: uuid.MustParse(fixtureProjectID)},
		Sort:           SortAdvisory,
		Limit:          20,
	}
	groups, _ := queryAdvisoryFixture(t, store, params, from)

	byID := map[string]AdvisoryGroup{}
	for _, g := range groups {
		byID[g.AdvisoryID] = g
	}
	if len(byID) != 3 {
		t.Fatalf("returned %d groups, want 3: %v", len(byID), advisoryIDs(groups))
	}

	mixed := byID["CVE-9000-0001"]
	if mixed.Severity == nil || *mixed.Severity != "critical" {
		t.Errorf("severity = %v, want the highest of the group (critical)", mixed.Severity)
	}
	if mixed.MaxDecreeScore == nil || *mixed.MaxDecreeScore != 9.9 {
		t.Errorf("max_decree_score = %v, want 9.9", mixed.MaxDecreeScore)
	}
	if mixed.EPSSScore == nil || *mixed.EPSSScore != 0.5 {
		t.Errorf("epss_score = %v, want 0.5", mixed.EPSSScore)
	}
	if mixed.CVSSScore == nil || *mixed.CVSSScore != 9.8 {
		t.Errorf("cvss_score = %v, want 9.8", mixed.CVSSScore)
	}
	if mixed.InstanceCount != 3 || mixed.TargetCount != 2 {
		t.Errorf("instance_count/target_count = %d/%d, want 3/2", mixed.InstanceCount, mixed.TargetCount)
	}
	if strings.Join(mixed.TargetNames, ",") != "api,web" {
		t.Errorf("target_names = %v, want distinct and sorted [api web]", mixed.TargetNames)
	}
	if strings.Join(mixed.PackageNames, ",") != "left-pad" ||
		strings.Join(mixed.Ecosystems, ",") != "npm" {
		t.Errorf("package_names/ecosystems = %v/%v", mixed.PackageNames, mixed.Ecosystems)
	}
	if !mixed.IsActive {
		t.Error("is_active must be true when any instance is active")
	}
	if mixed.LastObservedAt == nil || mixed.LastObservedAt.UTC().Format("2006-01-02") != "2026-03-05" {
		t.Errorf("last_observed_at = %v, want the group maximum 2026-03-05", mixed.LastObservedAt)
	}
	if mixed.FirstObservedAt == nil || mixed.FirstObservedAt.UTC().Format("2006-01-02") != "2026-02-19" {
		t.Errorf("first_observed_at = %v, want the group minimum 2026-02-19", mixed.FirstObservedAt)
	}

	allNull, ok := byID["CVE-9000-0002"]
	if !ok {
		t.Fatal("an advisory whose instances are all NULL must still be listed")
	}
	if allNull.Severity != nil || allNull.MaxDecreeScore != nil ||
		allNull.EPSSScore != nil || allNull.CVSSScore != nil || allNull.LastObservedAt != nil {
		t.Errorf("all-NULL group invented values: %+v", allNull)
	}
	if allNull.InstanceCount != 1 || allNull.IsActive {
		t.Errorf("all-NULL group = %d instances, active=%v", allNull.InstanceCount, allNull.IsActive)
	}

	wide := byID["CVE-9000-0003"]
	if wide.TargetCount != 6 {
		t.Errorf("target_count = %d, want the true distinct count 6", wide.TargetCount)
	}
	if len(wide.TargetNames) != AdvisoryNameCap {
		t.Errorf("target_names = %v, want %d entries", wide.TargetNames, AdvisoryNameCap)
	}
	if strings.Join(wide.TargetNames, ",") != "t-1,t-2,t-3,t-4,t-5" {
		t.Errorf("target_names = %v, want the first %d sorted names", wide.TargetNames, AdvisoryNameCap)
	}
}

func TestListAdvisories_FiltersApplyBeforeAggregation(t *testing.T) {
	store := testPool(t)
	from := advisoryFixtureFrom(advisoryFixture)
	projectID := uuid.MustParse(fixtureProjectID)

	activeOnly := AdvisoryParams{
		FindingFilters: FindingFilters{ProjectID: projectID, ActiveOnly: true},
		Sort:           SortAdvisory,
		Limit:          20,
	}
	groups, _ := queryAdvisoryFixture(t, store, activeOnly, from)
	byID := map[string]AdvisoryGroup{}
	for _, g := range groups {
		byID[g.AdvisoryID] = g
	}
	mixed, ok := byID["CVE-9000-0001"]
	if !ok {
		t.Fatal("CVE-9000-0001 has an active instance and must survive active_only")
	}
	if mixed.InstanceCount != 1 || mixed.TargetCount != 1 {
		t.Errorf("active_only counts = %d/%d, want 1/1 (filter applies before grouping)",
			mixed.InstanceCount, mixed.TargetCount)
	}
	if mixed.Severity == nil || *mixed.Severity != "high" {
		t.Errorf("severity = %v; the critical instance is inactive and must be excluded", mixed.Severity)
	}
	if _, ok := byID["CVE-9000-0002"]; ok {
		t.Error("an advisory with no active instance must drop out entirely")
	}

	// CVE-9000-0001 spans a 5.0 instance on api, a 9.9 instance on web and an
	// unscored one, so a threshold between them has to be visible in the counts.
	minScore := float32(6)
	scored := AdvisoryParams{
		FindingFilters: FindingFilters{ProjectID: projectID, MinScore: &minScore},
		Sort:           SortAdvisory,
		Limit:          20,
	}
	groups, _ = queryAdvisoryFixture(t, store, scored, from)
	byID = map[string]AdvisoryGroup{}
	for _, g := range groups {
		byID[g.AdvisoryID] = g
	}
	mixed, ok = byID["CVE-9000-0001"]
	if !ok {
		t.Fatal("CVE-9000-0001 has a 9.9 instance and must survive min_score=6")
	}
	if mixed.InstanceCount != 1 || mixed.TargetCount != 1 {
		t.Errorf("min_score counts = %d/%d, want 1/1 (filter applies before grouping)",
			mixed.InstanceCount, mixed.TargetCount)
	}
	if strings.Join(mixed.TargetNames, ",") != "web" {
		t.Errorf("target_names = %v, want only the target above the threshold", mixed.TargetNames)
	}
	if _, ok := byID["CVE-9000-0002"]; ok {
		t.Error("an advisory whose only instance is unscored must drop out of min_score")
	}
	if _, ok := byID["CVE-9000-0003"]; ok {
		t.Error("an advisory scoring 1.0 throughout must drop out of min_score=6")
	}

	advisory := "CVE-9000-0003"
	single := AdvisoryParams{
		FindingFilters: FindingFilters{ProjectID: projectID, Advisory: &advisory},
		Sort:           SortAdvisory,
		Limit:          20,
	}
	groups, _ = queryAdvisoryFixture(t, store, single, from)
	if len(groups) != 1 || groups[0].AdvisoryID != advisory {
		t.Errorf("advisory filter returned %v, want just %s", advisoryIDs(groups), advisory)
	}
}

func TestListAdvisories_RealTablesAcceptEverySort(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()
	q := "lodash"
	severity := "critical"
	ecosystem := "npm"
	advisory := "CVE-2021-44228"
	minEPSS := float32(0.1)
	minScore := float32(5)

	for _, key := range advisorySortKeyOrder {
		for _, desc := range []bool{true, false} {
			params := AdvisoryParams{
				FindingFilters: FindingFilters{
					ProjectID:  uuid.New(),
					Severity:   &severity,
					Ecosystem:  &ecosystem,
					MinEPSS:    &minEPSS,
					MinScore:   &minScore,
					Advisory:   &advisory,
					Query:      &q,
					ActiveOnly: true,
				},
				Sort:     key,
				SortDesc: desc,
				Limit:    10,
			}
			value, err := ParseAdvisorySortValue(key, FormatAdvisorySortValue(key, AdvisoryGroup{}))
			if err != nil {
				t.Fatalf("%s: %v", key, err)
			}
			params.Cursor = &AdvisoryCursor{Sort: key, Desc: desc, Value: value, AdvisoryID: "CVE-2021-44228"}

			if _, _, err := store.ListAdvisories(ctx, params); err != nil {
				t.Errorf("sort=%s desc=%v: %v", key, desc, err)
			}
		}
	}
}

// The grouping must partition the findings list, not resample it.
func TestListAdvisories_InstanceCountsSumToFindingCount(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()

	projects, err := store.ListProjects(ctx)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(projects) == 0 {
		t.Skip("no projects seeded")
	}

	for _, p := range projects {
		findings, more, err := store.ListFindings(ctx,
			FindingParams{FindingFilters: FindingFilters{ProjectID: p.ID}, Limit: 20000})
		if err != nil {
			t.Fatalf("ListFindings: %v", err)
		}
		if more {
			t.Fatalf("project %s exceeded the test limit", p.Name)
		}

		groups, more, err := store.ListAdvisories(ctx,
			AdvisoryParams{FindingFilters: FindingFilters{ProjectID: p.ID}, Limit: 20000})
		if err != nil {
			t.Fatalf("ListAdvisories: %v", err)
		}
		if more {
			t.Fatalf("project %s exceeded the test limit", p.Name)
		}

		var total int64
		distinct := map[string]bool{}
		for _, f := range findings {
			distinct[f.AdvisoryID] = true
		}
		for _, g := range groups {
			total += g.InstanceCount
			if g.TargetCount > g.InstanceCount {
				t.Errorf("%s: target_count %d exceeds instance_count %d",
					g.AdvisoryID, g.TargetCount, g.InstanceCount)
			}
			if len(g.TargetNames) > AdvisoryNameCap {
				t.Errorf("%s: target_names exceeds the cap: %v", g.AdvisoryID, g.TargetNames)
			}
		}
		if total != int64(len(findings)) {
			t.Errorf("project %s: instance_count sums to %d, findings list has %d",
				p.Name, total, len(findings))
		}
		if len(groups) != len(distinct) {
			t.Errorf("project %s: %d groups for %d distinct advisories",
				p.Name, len(groups), len(distinct))
		}
	}
}
