//go:build integration

package db

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// The keyset tests run the real WHERE/ORDER BY/LIMIT built by buildFindingsQuery
// against an in-query VALUES fixture, so they exercise PostgreSQL comparison and
// ordering semantics without reading or writing any table.

const fixtureProjectID = "aaaaaaaa-0000-0000-0000-000000000001"

type fixtureRow struct {
	id             string
	packageName    string
	packageVersion string
	ecosystem      string
	advisoryID     string
	severity       string // "" means SQL NULL
	score          string // "" means SQL NULL
	voEPSS         string
	snapshotEPSS   string
	cvss           string
	active         bool
	observedAt     string // "" means SQL NULL
	targetName     string
}

// Ties on every sortable column, plus NULLs, so a wrong keyset predicate
// either skips or repeats rows instead of walking past the tie group.
var keysetFixture = []fixtureRow{
	{"11111111-0000-0000-0000-000000000001", "lodash", "4.17.20", "npm", "CVE-2024-0001", "critical", "9.9", "0.5", "", "9.8", true, "2026-03-01T00:00:00Z", "api"},
	{"11111111-0000-0000-0000-000000000002", "lodash", "4.17.21", "npm", "CVE-2024-0002", "HIGH", "5.0", "0.5", "", "7.5", true, "2026-03-01T00:00:00Z", "api"},
	{"11111111-0000-0000-0000-000000000003", "express", "4.18.0", "npm", "CVE-2024-0002", "high", "5.0", "", "0.5", "7.5", true, "2026-03-02T00:00:00Z", "api"},
	{"11111111-0000-0000-0000-000000000004", "express", "4.18.1", "npm", "CVE-2024-0003", "medium", "5.0", "", "", "", true, "", "web"},
	{"11111111-0000-0000-0000-000000000005", "requests", "2.31.0", "pypi", "CVE-2024-0004", "", "", "", "", "", true, "", "web"},
	{"11111111-0000-0000-0000-000000000006", "requests", "2.31.0", "pypi", "CVE-2024-0005", "unknown", "", "0.0", "", "0.0", false, "2026-03-03T12:00:00Z", "web"},
	{"11111111-0000-0000-0000-000000000007", "urllib3", "1.26.0", "pypi", "CVE-2024-0006", "low", "", "", "", "3.1", true, "2026-03-03T12:00:00Z", "worker"},
	{"11111111-0000-0000-0000-000000000008", "urllib3", "2.0.0", "pypi", "CVE-2024-0006", "low", "0", "0.1", "", "3.1", true, "", "worker"},
	{"11111111-0000-0000-0000-000000000009", "openssl", "3.0.0", "alpine", "CVE-2024-0007", "Critical", "5.0", "0.9", "", "9.8", true, "2026-03-04T00:00:00Z", "worker"},
	{"11111111-0000-0000-0000-00000000000a", "openssl", "3.0.1", "alpine", "CVE-2024-0008", "critical", "9.9", "", "0.9", "", true, "2026-03-04T00:00:00Z", "api"},
	{"11111111-0000-0000-0000-00000000000b", "zlib", "1.2.11", "alpine", "CVE-2024-0009", "medium", "", "", "", "", false, "", "api"},
	{"11111111-0000-0000-0000-00000000000c", "zlib", "1.2.12", "alpine", "CVE-2024-0010", "", "5.0", "0.5", "", "7.5", true, "2026-03-01T00:00:00Z", "web"},
}

// fixtureTargetID derives a stable target id per target name so grouped counts
// over the fixture see the same target cardinality the names imply.
func fixtureTargetID(name string) string {
	return uuid.NewSHA1(uuid.Nil, []byte(name)).String()
}

func sqlText(s string) string {
	if s == "" {
		return "NULL"
	}
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func sqlNum(s string) string {
	if s == "" {
		return "NULL"
	}
	return s
}

// fixtureFrom renders a FROM clause exposing the same aliases and columns as
// findingsFrom, built entirely from literals so nothing is read from disk.
func fixtureFrom(rows []fixtureRow) string {
	tuples := make([]string, 0, len(rows))
	for _, r := range rows {
		tuples = append(tuples, fmt.Sprintf(
			"(%s::uuid, %s::uuid, %s::text, %s::text, %s::text, %s::text, %s::text, %s::real, %s::real, %s::real, %s::real, %t, %s::timestamptz, %s::text, %s::uuid)",
			sqlText(r.id), sqlText(fixtureTargetID(r.targetName)), sqlText(r.packageName), sqlText(r.packageVersion),
			sqlText(r.ecosystem), sqlText(r.advisoryID), sqlText(r.severity), sqlNum(r.score),
			sqlNum(r.voEPSS), sqlNum(r.snapshotEPSS), sqlNum(r.cvss), r.active,
			sqlText(r.observedAt), sqlText(r.targetName), sqlText(fixtureProjectID)))
	}
	return fmt.Sprintf(`
	FROM (VALUES
		%s
	) AS f(id, target_id, package_name, package_version, ecosystem, advisory_id,
	       last_severity, last_score, vo_epss, snapshot_epss, cvss_score, is_active,
	       last_observed_at, target_name, project_id)
	CROSS JOIN LATERAL (SELECT f.id AS id, f.target_id AS target_id, f.package_name AS package_name,
	                           f.package_version AS package_version, f.ecosystem AS ecosystem,
	                           f.advisory_id AS advisory_id) vi
	CROSS JOIN LATERAL (SELECT f.last_severity AS last_severity, f.last_score AS last_score,
	                           f.is_active AS is_active, f.last_observed_at AS last_observed_at) cfs
	CROSS JOIN LATERAL (SELECT f.target_name AS name, f.project_id AS project_id) t
	CROSS JOIN LATERAL (SELECT f.vo_epss AS epss_score, f.cvss_score AS cvss_score) vo
	CROSS JOIN LATERAL (SELECT f.snapshot_epss AS epss_score) epss
`, strings.Join(tuples, ",\n\t\t"))
}

func queryFixture(t *testing.T, store *PgStore, params FindingParams, from string) ([]Finding, bool) {
	t.Helper()
	query, args := buildFindingsQuery(params, from)
	rows, err := store.pool.Query(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("query: %v\n%s", err, query)
	}
	findings, err := pgx.CollectRows(rows, scanFinding)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	hasMore := len(findings) > params.Limit
	if hasMore {
		findings = findings[:params.Limit]
	}
	return findings, hasMore
}

func ids(findings []Finding) []string {
	out := make([]string, 0, len(findings))
	for _, f := range findings {
		out = append(out, f.InstanceID.String())
	}
	return out
}

func TestListFindings_KeysetPaginationCoversEveryRowOnce(t *testing.T) {
	store := testPool(t)
	from := fixtureFrom(keysetFixture)
	projectID := uuid.MustParse(fixtureProjectID)

	for _, key := range sortKeyOrder {
		for _, desc := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s_%v", key, desc), func(t *testing.T) {
				base := FindingParams{
					FindingFilters: FindingFilters{ProjectID: projectID},
					Sort:           key,
					SortDesc:       desc,
				}

				unpaged := base
				unpaged.Limit = len(keysetFixture) + 10
				want, _ := queryFixture(t, store, unpaged, from)
				if len(want) != len(keysetFixture) {
					t.Fatalf("unpaged returned %d rows, want %d", len(want), len(keysetFixture))
				}

				var got []Finding
				page := base
				page.Limit = 3
				for i := 0; ; i++ {
					if i > len(keysetFixture)+5 {
						t.Fatalf("pagination did not terminate; collected %d rows", len(got))
					}
					rows, hasMore := queryFixture(t, store, page, from)
					got = append(got, rows...)
					if !hasMore {
						break
					}
					last := rows[len(rows)-1]
					value, err := ParseSortValue(key, FormatSortValue(key, last))
					if err != nil {
						t.Fatalf("cursor value round-trip: %v", err)
					}
					page.Cursor = &FindingCursor{Sort: key, Desc: desc, Value: value, InstanceID: last.InstanceID}
				}

				gotIDs, wantIDs := ids(got), ids(want)
				seen := map[string]int{}
				for _, id := range gotIDs {
					seen[id]++
				}
				for id, n := range seen {
					if n > 1 {
						t.Errorf("row %s returned %d times", id, n)
					}
				}
				for _, id := range wantIDs {
					if seen[id] == 0 {
						t.Errorf("row %s never returned", id)
					}
				}
				if strings.Join(gotIDs, ",") != strings.Join(wantIDs, ",") {
					t.Errorf("paged order\n got: %v\nwant: %v", gotIDs, wantIDs)
				}
			})
		}
	}
}

func TestListFindings_SearchAndFiltersPaginate(t *testing.T) {
	store := testPool(t)
	from := fixtureFrom(keysetFixture)
	projectID := uuid.MustParse(fixtureProjectID)

	q := "LOD"
	ecosystem := "npm"
	params := FindingParams{
		FindingFilters: FindingFilters{ProjectID: projectID, Query: &q, Ecosystem: &ecosystem},
		Sort:           SortPackage,
		Limit:          10,
	}
	rows, _ := queryFixture(t, store, params, from)
	if len(rows) != 2 {
		t.Fatalf("q=LOD ecosystem=npm returned %d rows, want 2: %v", len(rows), ids(rows))
	}

	// Escaped metacharacters must be matched literally, not as wildcards.
	for _, pattern := range []string{"%", "_", "lodash%", `\`} {
		p := params
		p.Query = &pattern
		p.Ecosystem = nil
		rows, _ := queryFixture(t, store, p, from)
		if len(rows) != 0 {
			t.Errorf("q=%q matched %d rows, want 0 (metacharacters must be escaped)", pattern, len(rows))
		}
	}

	// Search spans target name as well as package name and advisory id.
	for pattern, wantN := range map[string]int{"worker": 3, "cve-2024-0006": 2, "URLLIB3": 2} {
		p := params
		p.Query = &pattern
		p.Ecosystem = nil
		rows, _ := queryFixture(t, store, p, from)
		if len(rows) != wantN {
			t.Errorf("q=%q returned %d rows, want %d", pattern, len(rows), wantN)
		}
	}
}

// The fixture relation casts its columns explicitly; this drives the same query
// through the real column types so parameter inference is checked too.
func TestListFindings_RealTablesAcceptEverySort(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()
	q := "lodash"
	severity := "critical"
	ecosystem := "npm"
	minEPSS := float32(0.1)
	advisory := "CVE-2024-0001"

	for _, key := range sortKeyOrder {
		for _, desc := range []bool{true, false} {
			params := FindingParams{
				FindingFilters: FindingFilters{
					ProjectID:  uuid.New(),
					Severity:   &severity,
					Ecosystem:  &ecosystem,
					MinEPSS:    &minEPSS,
					Advisory:   &advisory,
					Query:      &q,
					ActiveOnly: true,
				},
				Sort:     key,
				SortDesc: desc,
				Limit:    10,
			}
			value, err := ParseSortValue(key, FormatSortValue(key, Finding{}))
			if err != nil {
				t.Fatalf("%s: %v", key, err)
			}
			params.Cursor = &FindingCursor{Sort: key, Desc: desc, Value: value, InstanceID: uuid.New()}

			if _, _, err := store.ListFindings(ctx, params); err != nil {
				t.Errorf("sort=%s desc=%v: %v", key, desc, err)
			}
		}
	}
}

func TestGetFindingFacets_RealTables(t *testing.T) {
	store := testPool(t)
	ctx := context.Background()

	for _, activeOnly := range []bool{true, false} {
		facets, err := store.GetFindingFacets(ctx, uuid.New(), activeOnly)
		if err != nil {
			t.Fatalf("active_only=%v: %v", activeOnly, err)
		}
		if facets.Ecosystems == nil {
			t.Error("ecosystems must be an empty array, not null")
		}
		for _, sev := range canonicalSeverities {
			if _, ok := facets.SeverityCounts[sev]; !ok {
				t.Errorf("severity_counts is missing the %q key", sev)
			}
		}
		if facets.Total != 0 {
			t.Errorf("total = %d for an unknown project, want 0", facets.Total)
		}
	}
}

func TestGetProject_NotFound(t *testing.T) {
	store := testPool(t)
	p, err := store.GetProject(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if p != nil {
		t.Error("expected nil for an unknown project")
	}
}

func TestSeverityFilterMatchesFacetCounts(t *testing.T) {
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
		facets, err := store.GetFindingFacets(ctx, p.ID, false)
		if err != nil {
			t.Fatalf("GetFindingFacets: %v", err)
		}
		for _, sev := range canonicalSeverities {
			severity := sev
			params := FindingParams{
				FindingFilters: FindingFilters{ProjectID: p.ID, Severity: &severity},
				Limit:          5000,
			}
			rows, more, err := store.ListFindings(ctx, params)
			if err != nil {
				t.Fatalf("ListFindings severity=%s: %v", sev, err)
			}
			if more {
				t.Fatalf("severity=%s exceeded the test limit", sev)
			}
			if len(rows) != facets.SeverityCounts[sev] {
				t.Errorf("project %s severity=%s: filter returned %d rows, facet says %d",
					p.Name, sev, len(rows), facets.SeverityCounts[sev])
			}
		}
	}
}
