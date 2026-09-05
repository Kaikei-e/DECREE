package db

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// SortKey is a whitelisted sort column for the findings list.
type SortKey string

const (
	SortDecreeScore  SortKey = "decree_score"
	SortSeverity     SortKey = "severity"
	SortEPSS         SortKey = "epss"
	SortCVSS         SortKey = "cvss"
	SortPackage      SortKey = "package"
	SortAdvisory     SortKey = "advisory"
	SortTarget       SortKey = "target"
	SortLastObserved SortKey = "last_observed"
)

const DefaultSortKey = SortDecreeScore

// MaxSearchLength caps the free-text `q` filter, in runes.
const MaxSearchLength = 128

// MaxDecreeScore is the upper bound of the DECREE Score scale (ADR-0035); it
// bounds the `min_score` filter.
const MaxDecreeScore = 10

// sortColumn describes one whitelisted sort key. Every expr is total (never
// NULL) so the ORDER BY and the keyset predicate compare the same value space.
type sortColumn struct {
	expr        string
	cast        string
	defaultDesc bool
	format      func(Finding) string
	parse       func(string) (any, error)
}

// severityRankExpr mirrors the scanner's severity_label output. The scanner
// writes lowercase labels (ADR-0029) but lower() keeps the order correct for
// any casing that reaches the projection.
const severityRankExpr = `CASE lower(cfs.last_severity)
			WHEN 'critical' THEN 4
			WHEN 'high' THEN 3
			WHEN 'medium' THEN 2
			WHEN 'low' THEN 1
			ELSE 0
		END`

// sortEpoch is the sentinel COALESCEd in for a NULL last_observed_at, so
// never-observed findings sort last on the default (descending) direction.
var sortEpoch = time.Time{}

func severityRank(s *string) int {
	if s == nil {
		return 0
	}
	switch strings.ToLower(*s) {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	}
	return 0
}

func formatFloat(v *float32) string {
	f := float32(0)
	if v != nil {
		f = *v
	}
	return strconv.FormatFloat(float64(f), 'g', -1, 32)
}

func parseFloat(s string) (any, error) {
	f, err := strconv.ParseFloat(s, 32)
	if err != nil {
		return nil, err
	}
	return float32(f), nil
}

func parseInt(s string) (any, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return nil, err
	}
	return int32(n), nil
}

func parseText(s string) (any, error) { return s, nil }

func parseTime(s string) (any, error) {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return nil, err
	}
	return t, nil
}

var findingSortColumns = map[SortKey]sortColumn{
	SortDecreeScore: {
		expr: "COALESCE(cfs.last_score, 0)", cast: "real", defaultDesc: true,
		format: func(f Finding) string { return formatFloat(f.DecreeScore) },
		parse:  parseFloat,
	},
	SortSeverity: {
		expr: severityRankExpr, cast: "int", defaultDesc: true,
		format: func(f Finding) string { return strconv.Itoa(severityRank(f.Severity)) },
		parse:  parseInt,
	},
	SortEPSS: {
		expr: "COALESCE(epss.epss_score, vo.epss_score, 0)", cast: "real", defaultDesc: true,
		format: func(f Finding) string { return formatFloat(f.EPSSScore) },
		parse:  parseFloat,
	},
	SortCVSS: {
		expr: "COALESCE(vo.cvss_score, 0)", cast: "real", defaultDesc: true,
		format: func(f Finding) string { return formatFloat(f.CVSSScore) },
		parse:  parseFloat,
	},
	SortPackage: {
		expr: "vi.package_name", cast: "text", defaultDesc: false,
		format: func(f Finding) string { return f.PackageName },
		parse:  parseText,
	},
	SortAdvisory: {
		expr: "vi.advisory_id", cast: "text", defaultDesc: false,
		format: func(f Finding) string { return f.AdvisoryID },
		parse:  parseText,
	},
	SortTarget: {
		expr: "t.name", cast: "text", defaultDesc: false,
		format: func(f Finding) string { return f.TargetName },
		parse:  parseText,
	},
	SortLastObserved: {
		expr: "COALESCE(cfs.last_observed_at, $EPOCH$)", cast: "timestamptz", defaultDesc: true,
		format: func(f Finding) string {
			t := sortEpoch
			if f.LastObservedAt != nil {
				t = *f.LastObservedAt
			}
			return t.UTC().Format(time.RFC3339Nano)
		},
		parse: parseTime,
	},
}

var sortKeyOrder = []SortKey{
	SortDecreeScore, SortSeverity, SortEPSS, SortCVSS,
	SortPackage, SortAdvisory, SortTarget, SortLastObserved,
}

// SortKeys lists the accepted `sort` values in a stable order.
func SortKeys() []string {
	out := make([]string, 0, len(sortKeyOrder))
	for _, k := range sortKeyOrder {
		out = append(out, string(k))
	}
	return out
}

// ParseSortKey resolves a client-supplied sort key against the whitelist.
func ParseSortKey(s string) (SortKey, bool) {
	k := SortKey(s)
	if _, ok := findingSortColumns[k]; !ok {
		return "", false
	}
	return k, true
}

// DefaultDescending reports the useful default direction for a sort key.
func (k SortKey) DefaultDescending() bool {
	return findingSortColumns[k].defaultDesc
}

// FormatSortValue renders the row's sort value for the pagination cursor.
func FormatSortValue(k SortKey, f Finding) string {
	return findingSortColumns[k].format(f)
}

// ParseSortValue turns a cursor's sort value back into a bindable argument.
func ParseSortValue(k SortKey, raw string) (any, error) {
	c, ok := findingSortColumns[k]
	if !ok {
		return nil, fmt.Errorf("unknown sort key %q", k)
	}
	return c.parse(raw)
}

// escapeLike neutralises LIKE metacharacters in user input; the pattern itself
// is always sent as a bound parameter.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

const findingsSelect = `
	SELECT vi.id, vi.target_id, t.name, vi.package_name, vi.package_version,
	       vi.ecosystem, vi.advisory_id, cfs.last_severity, cfs.last_score,
	       COALESCE(epss.epss_score, vo.epss_score), vo.cvss_score, cfs.is_active, cfs.last_observed_at
`

const findingsFrom = `
	FROM current_finding_status cfs
	JOIN vulnerability_instances vi ON vi.id = cfs.instance_id
	JOIN targets t ON t.id = vi.target_id
	LEFT JOIN LATERAL (
		SELECT epss_score, cvss_score FROM vulnerability_observations
		WHERE instance_id = vi.id ORDER BY observed_at DESC LIMIT 1
	) vo ON true
	LEFT JOIN LATERAL (
		SELECT epss_score
		FROM advisory_epss_snapshots
		WHERE cve_id = vi.advisory_id
		ORDER BY epss_date DESC
		LIMIT 1
	) epss ON true
`

// binder assigns bound parameter positions in the order values are added.
type binder struct{ args []any }

func (b *binder) bind(v any) int {
	b.args = append(b.args, v)
	return len(b.args)
}

// filterConditions renders the WHERE clauses shared by the findings list and the
// advisory grouping, so the grouped counts describe the same instance set.
func filterConditions(f FindingFilters, b *binder) []string {
	conditions := []string{fmt.Sprintf("t.project_id = $%d", b.bind(f.ProjectID))}

	if f.ActiveOnly {
		conditions = append(conditions, "cfs.is_active = true")
	}
	if f.Severity != nil {
		// The projection leaves last_severity NULL for never-scored findings and
		// the facets endpoint counts those as unknown, so the filter must agree.
		cond := "cfs.last_severity = $%d"
		if *f.Severity == "unknown" {
			cond = "(cfs.last_severity = $%d OR cfs.last_severity IS NULL)"
		}
		conditions = append(conditions, fmt.Sprintf(cond, b.bind(*f.Severity)))
	}
	if f.Ecosystem != nil {
		conditions = append(conditions, fmt.Sprintf("vi.ecosystem = $%d", b.bind(*f.Ecosystem)))
	}
	if f.Advisory != nil {
		conditions = append(conditions, fmt.Sprintf("vi.advisory_id = $%d", b.bind(*f.Advisory)))
	}
	if f.MinEPSS != nil {
		conditions = append(conditions, fmt.Sprintf(
			"COALESCE(epss.epss_score, vo.epss_score) >= $%d", b.bind(*f.MinEPSS)))
	}
	// An unscored finding cannot be asserted to clear a threshold, so a NULL
	// last_score drops out rather than being COALESCEd to zero. At zero the
	// threshold is the identity and must keep those rows, so it adds nothing.
	if f.MinScore != nil && *f.MinScore > 0 {
		conditions = append(conditions, fmt.Sprintf("cfs.last_score >= $%d", b.bind(*f.MinScore)))
	}
	if f.Query != nil {
		n := b.bind("%" + escapeLike(*f.Query) + "%")
		conditions = append(conditions, fmt.Sprintf(
			`(vi.package_name ILIKE $%[1]d ESCAPE E'\\'
			  OR vi.advisory_id ILIKE $%[1]d ESCAPE E'\\'
			  OR t.name ILIKE $%[1]d ESCAPE E'\\')`, n))
	}
	return conditions
}

// buildFindingsQuery assembles the findings query against the given FROM clause.
// The clause is a parameter so tests can drive the same WHERE/ORDER BY logic
// over a fixture relation instead of the live tables.
func buildFindingsQuery(params FindingParams, from string) (string, []any) {
	key := params.Sort
	if _, ok := findingSortColumns[key]; !ok {
		key = DefaultSortKey
	}
	col := findingSortColumns[key]

	b := &binder{}
	conditions := filterConditions(params.FindingFilters, b)

	// Row-wise keyset: the vi.id tie-break follows the sort direction so the
	// predicate is exactly the negation of "already returned" for the ORDER BY.
	sortExpr := sortExpression(col.expr)
	if params.Cursor != nil {
		op := ">"
		if params.SortDesc {
			op = "<"
		}
		vN := b.bind(params.Cursor.Value)
		idN := b.bind(params.Cursor.InstanceID)
		conditions = append(conditions, fmt.Sprintf("(%s, vi.id) %s ($%d::%s, $%d::uuid)",
			sortExpr, op, vN, col.cast, idN))
	}

	direction := "ASC"
	if params.SortDesc {
		direction = "DESC"
	}

	query := fmt.Sprintf(`%s%s
		WHERE %s
		ORDER BY %s %s, vi.id %s
		LIMIT $%d
	`, findingsSelect, from, strings.Join(conditions, " AND "),
		sortExpr, direction, direction, b.bind(params.Limit+1))

	return query, b.args
}

func sortExpression(expr string) string {
	return strings.ReplaceAll(expr, "$EPOCH$", "'0001-01-01T00:00:00Z'::timestamptz")
}
