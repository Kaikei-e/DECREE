package db

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const latestEpssJoin = `
		LEFT JOIN LATERAL (
			SELECT epss_score
			FROM advisory_epss_snapshots
			WHERE cve_id = vi.advisory_id
			ORDER BY epss_date DESC
			LIMIT 1
		) epss ON true
`

// PgStore implements Store using pgxpool.
type PgStore struct {
	pool *pgxpool.Pool
}

func NewPgStore(pool *pgxpool.Pool) *PgStore {
	return &PgStore{pool: pool}
}

// scanProject scans a single Project row.
func scanProject(row pgx.CollectableRow) (Project, error) {
	var p Project
	err := row.Scan(&p.ID, &p.Name, &p.CreatedAt)
	return p, err
}

// scanTarget scans a single Target row.
func scanTarget(row pgx.CollectableRow) (Target, error) {
	var t Target
	err := row.Scan(&t.ID, &t.ProjectID, &t.Name, &t.TargetType,
		&t.SourceRef, &t.Branch, &t.Subpath, &t.ExposureClass, &t.CreatedAt)
	return t, err
}

// scanFinding scans a single Finding row.
func scanFinding(row pgx.CollectableRow) (Finding, error) {
	var f Finding
	err := row.Scan(&f.InstanceID, &f.TargetID, &f.TargetName,
		&f.PackageName, &f.PackageVersion, &f.Ecosystem, &f.AdvisoryID,
		&f.Severity, &f.DecreeScore, &f.EPSSScore, &f.CVSSScore,
		&f.IsActive, &f.LastObservedAt)
	return f, err
}

// scanTimelineEvent scans a single TimelineEvent row.
func scanTimelineEvent(row pgx.CollectableRow) (TimelineEvent, error) {
	var e TimelineEvent
	err := row.Scan(&e.ID, &e.InstanceID, &e.ScanID, &e.EventType,
		&e.OccurredAt, &e.AdvisoryID, &e.PackageName,
		&e.Severity, &e.DecreeScore)
	return e, err
}

func (s *PgStore) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, created_at FROM projects ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	projects, err := pgx.CollectRows(rows, scanProject)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	return orEmpty(projects), nil
}

func (s *PgStore) ListTargets(ctx context.Context, projectID uuid.UUID) ([]Target, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, project_id, name, target_type, source_ref, branch, subpath, exposure_class, created_at
		 FROM targets WHERE project_id = $1 ORDER BY name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list targets: %w", err)
	}
	targets, err := pgx.CollectRows(rows, scanTarget)
	if err != nil {
		return nil, fmt.Errorf("list targets: %w", err)
	}
	return orEmpty(targets), nil
}

func (s *PgStore) ListFindings(ctx context.Context, params FindingParams) ([]Finding, bool, error) {
	fetchLimit := params.Limit + 1

	var conditions []string
	var args []any
	argN := 1

	conditions = append(conditions, fmt.Sprintf("t.project_id = $%d", argN))
	args = append(args, params.ProjectID)
	argN++

	if params.ActiveOnly {
		conditions = append(conditions, "cfs.is_active = true")
	}
	if params.Severity != nil {
		conditions = append(conditions, fmt.Sprintf("cfs.last_severity = $%d", argN))
		args = append(args, *params.Severity)
		argN++
	}
	if params.Ecosystem != nil {
		conditions = append(conditions, fmt.Sprintf("vi.ecosystem = $%d", argN))
		args = append(args, *params.Ecosystem)
		argN++
	}
	if params.MinEPSS != nil {
		conditions = append(conditions, fmt.Sprintf("COALESCE(epss.epss_score, vo.epss_score) >= $%d", argN))
		args = append(args, *params.MinEPSS)
		argN++
	}
	if params.Cursor != nil {
		conditions = append(conditions, fmt.Sprintf(
			"(COALESCE(cfs.last_score, 0), vi.id) < ($%d, $%d)", argN, argN+1))
		args = append(args, params.Cursor.Score, params.Cursor.InstanceID)
		argN += 2
	}

	where := strings.Join(conditions, " AND ")

	query := fmt.Sprintf(`
		SELECT vi.id, vi.target_id, t.name, vi.package_name, vi.package_version,
		       vi.ecosystem, vi.advisory_id, cfs.last_severity, cfs.last_score,
		       COALESCE(epss.epss_score, vo.epss_score), vo.cvss_score, cfs.is_active, cfs.last_observed_at
		FROM current_finding_status cfs
		JOIN vulnerability_instances vi ON vi.id = cfs.instance_id
		JOIN targets t ON t.id = vi.target_id
		LEFT JOIN LATERAL (
			SELECT epss_score, cvss_score FROM vulnerability_observations
			WHERE instance_id = vi.id ORDER BY observed_at DESC LIMIT 1
		) vo ON true
%s
		WHERE %s
		ORDER BY COALESCE(cfs.last_score, 0) DESC, vi.id
		LIMIT $%d
	`, latestEpssJoin, where, argN)
	args = append(args, fetchLimit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("list findings: %w", err)
	}
	findings, err := pgx.CollectRows(rows, scanFinding)
	if err != nil {
		return nil, false, fmt.Errorf("list findings: %w", err)
	}

	hasMore := len(findings) > params.Limit
	if hasMore {
		findings = findings[:params.Limit]
	}
	return orEmpty(findings), hasMore, nil
}

func (s *PgStore) GetFindingDetail(ctx context.Context, instanceID uuid.UUID) (*FindingDetail, error) {
	var d FindingDetail
	err := s.pool.QueryRow(ctx, `
		SELECT vi.id, vi.target_id, t.name, vi.package_name, vi.package_version,
		       vi.ecosystem, vi.advisory_id, vi.advisory_source,
		       cfs.last_severity, cfs.last_score, cfs.is_active, cfs.last_observed_at,
		       COALESCE(epss.epss_score, vo.epss_score), vo.cvss_score, vo.cvss_vector, vo.reachability,
		       vo.is_direct_dep, vo.dep_depth, t.exposure_class
		FROM vulnerability_instances vi
		JOIN current_finding_status cfs ON cfs.instance_id = vi.id
		JOIN targets t ON t.id = vi.target_id
		LEFT JOIN LATERAL (
			SELECT epss_score, cvss_score, cvss_vector, reachability, is_direct_dep, dep_depth
			FROM vulnerability_observations
			WHERE instance_id = vi.id ORDER BY observed_at DESC LIMIT 1
		) vo ON true
		LEFT JOIN LATERAL (
			SELECT epss_score
			FROM advisory_epss_snapshots
			WHERE cve_id = vi.advisory_id
			ORDER BY epss_date DESC
			LIMIT 1
		) epss ON true
		WHERE vi.id = $1
	`, instanceID).Scan(
		&d.InstanceID, &d.TargetID, &d.TargetName, &d.PackageName, &d.PackageVersion,
		&d.Ecosystem, &d.AdvisoryID, &d.AdvisorySource,
		&d.Severity, &d.DecreeScore, &d.IsActive, &d.LastObservedAt,
		&d.EPSSScore, &d.CVSSScore, &d.CVSSVector, &d.Reachability,
		&d.IsDirectDep, &d.DepDepth, &d.ExposureClass,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get finding detail: %w", err)
	}

	// Fix versions
	fixRows, err := s.pool.Query(ctx,
		`SELECT DISTINCT fixed_version FROM advisory_fix_versions WHERE instance_id = $1`, instanceID)
	if err != nil {
		return nil, fmt.Errorf("get fix versions: %w", err)
	}
	d.FixVersions, err = pgx.CollectRows(fixRows, func(row pgx.CollectableRow) (string, error) {
		var v string
		err := row.Scan(&v)
		return v, err
	})
	if err != nil {
		return nil, fmt.Errorf("get fix versions: %w", err)
	}
	d.FixVersions = orEmpty(d.FixVersions)

	// Exploits via advisory_id → exploit_cve_links → exploit_source_items
	exploitRows, err := s.pool.Query(ctx, `
		SELECT esi.source, esi.source_id, esi.title, esi.url, esi.published_at
		FROM exploit_cve_links ecl
		JOIN exploit_source_items esi ON esi.id = ecl.exploit_id
		WHERE ecl.cve_id = $1
	`, d.AdvisoryID)
	if err != nil {
		return nil, fmt.Errorf("get exploits: %w", err)
	}
	d.Exploits, err = pgx.CollectRows(exploitRows, func(row pgx.CollectableRow) (ExploitRef, error) {
		var e ExploitRef
		err := row.Scan(&e.Source, &e.SourceID, &e.Title, &e.URL, &e.PublishedAt)
		return e, err
	})
	if err != nil {
		return nil, fmt.Errorf("get exploits: %w", err)
	}
	d.Exploits = orEmpty(d.Exploits)

	// Dependency path from latest scan
	depRows, err := s.pool.Query(ctx, `
		SELECT from_pkg, to_pkg, dep_type
		FROM dependency_edges
		WHERE target_id = $1 AND scan_id = (
			SELECT latest_scan_id FROM current_finding_status WHERE instance_id = $2
		)
		ORDER BY dep_type, from_pkg
	`, d.TargetID, instanceID)
	if err != nil {
		return nil, fmt.Errorf("get dep edges: %w", err)
	}
	d.DependencyPath, err = pgx.CollectRows(depRows, func(row pgx.CollectableRow) (DependencyEdge, error) {
		var e DependencyEdge
		err := row.Scan(&e.FromPkg, &e.ToPkg, &e.DepType)
		return e, err
	})
	if err != nil {
		return nil, fmt.Errorf("get dep edges: %w", err)
	}
	d.DependencyPath = orEmpty(d.DependencyPath)

	return &d, nil
}

func (s *PgStore) ListTopRisks(ctx context.Context, projectID uuid.UUID, limit int) ([]Finding, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT vi.id, vi.target_id, t.name, vi.package_name, vi.package_version,
		       vi.ecosystem, vi.advisory_id, cfs.last_severity, cfs.last_score,
		       COALESCE(epss.epss_score, vo.epss_score), vo.cvss_score, cfs.is_active, cfs.last_observed_at
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
		WHERE t.project_id = $1 AND cfs.is_active = true AND cfs.last_score IS NOT NULL
		ORDER BY cfs.last_score DESC
		LIMIT $2
	`, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("list top risks: %w", err)
	}
	findings, err := pgx.CollectRows(rows, scanFinding)
	if err != nil {
		return nil, fmt.Errorf("list top risks: %w", err)
	}
	return orEmpty(findings), nil
}

func (s *PgStore) ListTimeline(ctx context.Context, params TimelineParams) ([]TimelineEvent, bool, error) {
	fetchLimit := params.Limit + 1

	var conditions []string
	var args []any
	argN := 1

	conditions = append(conditions, fmt.Sprintf("t.project_id = $%d", argN))
	args = append(args, params.ProjectID)
	argN++

	if params.TargetID != nil {
		conditions = append(conditions, fmt.Sprintf("vi.target_id = $%d", argN))
		args = append(args, *params.TargetID)
		argN++
	}

	obsConds := make([]string, len(conditions))
	copy(obsConds, conditions)
	disConds := make([]string, len(conditions))
	copy(disConds, conditions)

	if params.From != nil {
		obsConds = append(obsConds, fmt.Sprintf("vo.observed_at >= $%d", argN))
		disConds = append(disConds, fmt.Sprintf("vd.disappeared_at >= $%d", argN))
		args = append(args, *params.From)
		argN++
	}
	if params.To != nil {
		obsConds = append(obsConds, fmt.Sprintf("vo.observed_at <= $%d", argN))
		disConds = append(disConds, fmt.Sprintf("vd.disappeared_at <= $%d", argN))
		args = append(args, *params.To)
		argN++
	}

	if params.Cursor != nil {
		obsConds = append(obsConds, fmt.Sprintf("(vo.observed_at, vo.id) < ($%d, $%d)", argN, argN+1))
		disConds = append(disConds, fmt.Sprintf("(vd.disappeared_at, vd.id) < ($%d, $%d)", argN, argN+1))
		args = append(args, params.Cursor.OccurredAt, params.Cursor.ID)
		argN += 2
	}

	obsWhere := strings.Join(obsConds, " AND ")
	disWhere := strings.Join(disConds, " AND ")

	obsSelect := true
	disSelect := true
	if params.EventType != nil {
		switch *params.EventType {
		case "observed":
			disSelect = false
		case "disappeared":
			obsSelect = false
		}
	}

	var parts []string
	if obsSelect {
		parts = append(parts, fmt.Sprintf(`
			SELECT vo.id, vo.instance_id, vo.scan_id, 'observed' AS event_type,
			       vo.observed_at AS occurred_at, vi.advisory_id, vi.package_name,
			       vo.severity, vo.decree_score
			FROM vulnerability_observations vo
			JOIN vulnerability_instances vi ON vi.id = vo.instance_id
			JOIN targets t ON t.id = vi.target_id
			WHERE %s
		`, obsWhere))
	}
	if disSelect {
		parts = append(parts, fmt.Sprintf(`
			SELECT vd.id, vd.instance_id, vd.scan_id, 'disappeared' AS event_type,
			       vd.disappeared_at AS occurred_at, vi.advisory_id, vi.package_name,
			       NULL::text AS severity, NULL::real AS decree_score
			FROM vulnerability_disappearances vd
			JOIN vulnerability_instances vi ON vi.id = vd.instance_id
			JOIN targets t ON t.id = vi.target_id
			WHERE %s
		`, disWhere))
	}

	query := fmt.Sprintf(`
		%s
		ORDER BY occurred_at DESC, id
		LIMIT $%d
	`, strings.Join(parts, " UNION ALL "), argN)
	args = append(args, fetchLimit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("list timeline: %w", err)
	}
	events, err := pgx.CollectRows(rows, scanTimelineEvent)
	if err != nil {
		return nil, false, fmt.Errorf("list timeline: %w", err)
	}

	hasMore := len(events) > params.Limit
	if hasMore {
		events = events[:params.Limit]
	}
	return orEmpty(events), hasMore, nil
}
