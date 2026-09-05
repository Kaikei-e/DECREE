package db

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// SortInstanceCount orders advisories by how many instances they collapse; it
// only exists at the group level, so it is absent from the findings whitelist.
const SortInstanceCount SortKey = "instance_count"

const DefaultAdvisorySortKey = SortDecreeScore

// AdvisoryNameCap bounds the sample name lists returned per group. The distinct
// counts are unbounded, so the UI can render the remainder as "+N more".
const AdvisoryNameCap = 5

// advisorySortColumn is the group-level twin of sortColumn: every expr is an
// aggregate (or the grouping key) and is total, so the ORDER BY and the HAVING
// keyset compare the same value space.
type advisorySortColumn struct {
	expr        string
	cast        string
	defaultDesc bool
	format      func(AdvisoryGroup) string
	parse       func(string) (any, error)
}

func parseInt64(s string) (any, error) {
	return strconv.ParseInt(s, 10, 64)
}

var advisorySortColumns = map[SortKey]advisorySortColumn{
	SortDecreeScore: {
		expr: "COALESCE(MAX(cfs.last_score), 0)", cast: "real", defaultDesc: true,
		format: func(g AdvisoryGroup) string { return formatFloat(g.MaxDecreeScore) },
		parse:  parseFloat,
	},
	SortSeverity: {
		expr: "MAX(" + severityRankExpr + ")", cast: "int", defaultDesc: true,
		format: func(g AdvisoryGroup) string { return strconv.Itoa(severityRank(g.Severity)) },
		parse:  parseInt,
	},
	SortEPSS: {
		expr: "COALESCE(MAX(COALESCE(epss.epss_score, vo.epss_score)), 0)", cast: "real", defaultDesc: true,
		format: func(g AdvisoryGroup) string { return formatFloat(g.EPSSScore) },
		parse:  parseFloat,
	},
	SortCVSS: {
		expr: "COALESCE(MAX(vo.cvss_score), 0)", cast: "real", defaultDesc: true,
		format: func(g AdvisoryGroup) string { return formatFloat(g.CVSSScore) },
		parse:  parseFloat,
	},
	SortAdvisory: {
		expr: "vi.advisory_id", cast: "text", defaultDesc: false,
		format: func(g AdvisoryGroup) string { return g.AdvisoryID },
		parse:  parseText,
	},
	SortInstanceCount: {
		expr: "count(*)", cast: "bigint", defaultDesc: true,
		format: func(g AdvisoryGroup) string { return strconv.FormatInt(g.InstanceCount, 10) },
		parse:  parseInt64,
	},
	SortLastObserved: {
		expr: "COALESCE(MAX(cfs.last_observed_at), $EPOCH$)", cast: "timestamptz", defaultDesc: true,
		format: func(g AdvisoryGroup) string {
			t := sortEpoch
			if g.LastObservedAt != nil {
				t = *g.LastObservedAt
			}
			return t.UTC().Format(time.RFC3339Nano)
		},
		parse: parseTime,
	},
}

var advisorySortKeyOrder = []SortKey{
	SortDecreeScore, SortSeverity, SortEPSS, SortCVSS,
	SortAdvisory, SortInstanceCount, SortLastObserved,
}

// AdvisorySortKeys lists the accepted `sort` values in a stable order.
func AdvisorySortKeys() []string {
	out := make([]string, 0, len(advisorySortKeyOrder))
	for _, k := range advisorySortKeyOrder {
		out = append(out, string(k))
	}
	return out
}

// ParseAdvisorySortKey resolves a client-supplied sort key against the whitelist.
func ParseAdvisorySortKey(s string) (SortKey, bool) {
	k := SortKey(s)
	if _, ok := advisorySortColumns[k]; !ok {
		return "", false
	}
	return k, true
}

// AdvisoryDefaultDescending reports the useful default direction for a sort key.
func AdvisoryDefaultDescending(k SortKey) bool {
	return advisorySortColumns[k].defaultDesc
}

// FormatAdvisorySortValue renders the group's sort value for the cursor.
func FormatAdvisorySortValue(k SortKey, g AdvisoryGroup) string {
	return advisorySortColumns[k].format(g)
}

// ParseAdvisorySortValue turns a cursor's sort value back into a bindable argument.
func ParseAdvisorySortValue(k SortKey, raw string) (any, error) {
	c, ok := advisorySortColumns[k]
	if !ok {
		return nil, fmt.Errorf("unknown advisory sort key %q", k)
	}
	return c.parse(raw)
}

// The severity label comes from the highest-ranked instance rather than a rank
// lookup, so labels outside the canonical set survive the aggregation.
var advisoriesSelect = fmt.Sprintf(`
	SELECT vi.advisory_id,
	       (array_agg(cfs.last_severity ORDER BY %[1]s DESC, cfs.last_severity))[1],
	       MAX(cfs.last_score),
	       MAX(COALESCE(epss.epss_score, vo.epss_score)),
	       MAX(vo.cvss_score),
	       count(*),
	       count(DISTINCT vi.target_id),
	       (array_agg(DISTINCT t.name ORDER BY t.name))[1:%[2]d],
	       (array_agg(DISTINCT vi.package_name ORDER BY vi.package_name))[1:%[2]d],
	       (array_agg(DISTINCT vi.ecosystem ORDER BY vi.ecosystem))[1:%[2]d],
	       bool_or(cfs.is_active),
	       MIN(first_vo.observed_at),
	       MAX(cfs.last_observed_at)
`, severityRankExpr, AdvisoryNameCap)

// The grouped listing reads the same relation as the findings list plus the
// first observation of each instance.
const advisoriesFrom = findingsFrom + `
	LEFT JOIN LATERAL (
		SELECT min(observed_at) AS observed_at
		FROM vulnerability_observations
		WHERE instance_id = vi.id
	) first_vo ON true
`

// buildAdvisoriesQuery assembles the grouped query against the given FROM clause,
// which tests replace with a fixture relation.
func buildAdvisoriesQuery(params AdvisoryParams, from string) (string, []any) {
	key := params.Sort
	if _, ok := advisorySortColumns[key]; !ok {
		key = DefaultAdvisorySortKey
	}
	col := advisorySortColumns[key]

	b := &binder{}
	conditions := filterConditions(params.FindingFilters, b)

	// The keyset compares aggregates, so it belongs in HAVING; the advisory_id
	// tie-break follows the sort direction the same way vi.id does for findings.
	sortExpr := sortExpression(col.expr)
	having := ""
	if params.Cursor != nil {
		op := ">"
		if params.SortDesc {
			op = "<"
		}
		vN := b.bind(params.Cursor.Value)
		idN := b.bind(params.Cursor.AdvisoryID)
		having = fmt.Sprintf("\n\t\tHAVING (%s, vi.advisory_id) %s ($%d::%s, $%d::text)",
			sortExpr, op, vN, col.cast, idN)
	}

	direction := "ASC"
	if params.SortDesc {
		direction = "DESC"
	}

	query := fmt.Sprintf(`%s%s
		WHERE %s
		GROUP BY vi.advisory_id%s
		ORDER BY %s %s, vi.advisory_id %s
		LIMIT $%d
	`, advisoriesSelect, from, strings.Join(conditions, " AND "), having,
		sortExpr, direction, direction, b.bind(params.Limit+1))

	return query, b.args
}
