package db

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// ListTargets returns all targets from the database.
func (d *DB) ListTargets(ctx context.Context) ([]Target, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, project_id, name, target_type, source_ref, branch, subpath, exposure_class
		FROM targets
		ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var targets []Target
	for rows.Next() {
		var t Target
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Name, &t.TargetType,
			&t.SourceRef, &t.Branch, &t.Subpath, &t.ExposureClass); err != nil {
			return nil, err
		}
		targets = append(targets, t)
	}
	return targets, rows.Err()
}

// UpsertTarget inserts or updates a target, returning its ID.
func (d *DB) UpsertTarget(ctx context.Context, projectID uuid.UUID, name, targetType string, sourceRef, branch *string) (uuid.UUID, error) {
	var id uuid.UUID
	err := d.Pool.QueryRow(ctx, `
		INSERT INTO targets (project_id, name, target_type, source_ref, branch)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (project_id, name) DO UPDATE SET
			target_type = EXCLUDED.target_type,
			source_ref  = EXCLUDED.source_ref,
			branch      = EXCLUDED.branch
		RETURNING id`, projectID, name, targetType, sourceRef, branch).Scan(&id)

	if err != nil {
		// If ON CONFLICT DO NOTHING returned no rows, look up existing
		err2 := d.Pool.QueryRow(ctx, `
			SELECT id FROM targets WHERE project_id = $1 AND name = $2`,
			projectID, name).Scan(&id)
		if err2 != nil {
			return uuid.Nil, err2
		}
	}
	return id, nil
}

// EnsureProject creates a project if it doesn't exist, returning its ID.
func (d *DB) EnsureProject(ctx context.Context, name string) (uuid.UUID, error) {
	var id uuid.UUID
	err := d.Pool.QueryRow(ctx, `
		INSERT INTO projects (name)
		VALUES ($1)
		ON CONFLICT (name) DO NOTHING
		RETURNING id`, name).Scan(&id)

	if err != nil {
		err2 := d.Pool.QueryRow(ctx, `SELECT id FROM projects WHERE name = $1`, name).Scan(&id)
		if err2 != nil {
			return uuid.Nil, err2
		}
	}
	return id, nil
}

// AcquireLease attempts to acquire an exclusive lease for a target.
// Returns true if acquired, false if already held by another.
func (d *DB) AcquireLease(ctx context.Context, targetID uuid.UUID, holderID string, ttl time.Duration) (bool, error) {
	tag, err := d.Pool.Exec(ctx, `
		INSERT INTO job_leases (target_id, holder_id, acquired_at, expires_at)
		VALUES ($1, $2, now(), now() + $3::interval)
		ON CONFLICT (target_id) DO UPDATE
		SET holder_id = EXCLUDED.holder_id,
		    acquired_at = EXCLUDED.acquired_at,
		    expires_at = EXCLUDED.expires_at
		WHERE job_leases.expires_at < now()
		   OR job_leases.holder_id = EXCLUDED.holder_id`,
		targetID, holderID, ttl.String())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ReleaseLease releases a lease held by the given holder.
func (d *DB) ReleaseLease(ctx context.Context, targetID uuid.UUID, holderID string) error {
	_, err := d.Pool.Exec(ctx, `
		DELETE FROM job_leases
		WHERE target_id = $1 AND holder_id = $2`,
		targetID, holderID)
	return err
}

// ClearExpiredLeases removes all leases whose TTL has passed.
// Called on startup to reclaim leases left by a previous oracle instance.
func (d *DB) ClearExpiredLeases(ctx context.Context) error {
	tag, err := d.Pool.Exec(ctx, `DELETE FROM job_leases WHERE expires_at < now()`)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		slog.Info("cleared expired leases", "count", tag.RowsAffected())
	}
	return nil
}

// UpdateLeaseJobID sets the job_id on a lease.
func (d *DB) UpdateLeaseJobID(ctx context.Context, targetID uuid.UUID, jobID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE job_leases SET job_id = $1 WHERE target_id = $2`,
		jobID, targetID)
	return err
}

// GetCurrentObservations returns observations for a given scan.
func (d *DB) GetCurrentObservations(ctx context.Context, scanID uuid.UUID) ([]Observation, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT vo.instance_id, vi.package_name, vi.package_version, vi.ecosystem,
		       vi.advisory_id, vo.cvss_score, vo.epss_score, vo.decree_score,
		       vo.severity, vo.is_direct_dep, vo.dep_depth
		FROM vulnerability_observations vo
		JOIN vulnerability_instances vi ON vi.id = vo.instance_id
		WHERE vo.scan_id = $1`, scanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var obs []Observation
	for rows.Next() {
		var o Observation
		if err := rows.Scan(&o.InstanceID, &o.PackageName, &o.PackageVersion,
			&o.Ecosystem, &o.AdvisoryID, &o.CVSSScore, &o.EPSSScore,
			&o.DecreeScore, &o.Severity, &o.IsDirectDep, &o.DepDepth); err != nil {
			return nil, err
		}
		obs = append(obs, o)
	}
	return obs, rows.Err()
}

// GetPreviousCompletedScanID returns the scan_id of the most recent completed scan
// for the target before the given scan.
func (d *DB) GetPreviousCompletedScanID(ctx context.Context, targetID, currentScanID uuid.UUID) (uuid.UUID, error) {
	var prevID uuid.UUID
	err := d.Pool.QueryRow(ctx, `
		SELECT id FROM scans
		WHERE target_id = $1
		  AND status = 'completed'
		  AND id != $2
		ORDER BY completed_at DESC
		LIMIT 1`, targetID, currentScanID).Scan(&prevID)
	return prevID, err
}

// GetExploitLinkedCVEs returns a set of CVE IDs that have exploit links.
func (d *DB) GetExploitLinkedCVEs(ctx context.Context, cveIDs []string) (map[string]bool, error) {
	if len(cveIDs) == 0 {
		return map[string]bool{}, nil
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT DISTINCT cve_id FROM exploit_cve_links
		WHERE cve_id = ANY($1)`, cveIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]bool)
	for rows.Next() {
		var cveID string
		if err := rows.Scan(&cveID); err != nil {
			return nil, err
		}
		result[cveID] = true
	}
	return result, rows.Err()
}

// InsertDisappearance records a vulnerability disappearance.
func (d *DB) InsertDisappearance(ctx context.Context, instanceID, scanID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO vulnerability_disappearances (instance_id, scan_id)
		VALUES ($1, $2)`, instanceID, scanID)
	return err
}

// InsertOutboxEvent inserts an event into stream_outbox for publishing to Redis.
func (d *DB) InsertOutboxEvent(ctx context.Context, streamName string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = d.Pool.Exec(ctx, `
		INSERT INTO stream_outbox (stream_name, payload)
		VALUES ($1, $2)`, streamName, data)
	return err
}

// InsertDeliveryLog inserts a notification delivery log entry.
func (d *DB) InsertDeliveryLog(ctx context.Context, rec DeliveryRecord) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO notification_delivery_log
			(target_id, advisory_id, diff_kind, channel, status, attempts, dedup_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		rec.TargetID, rec.AdvisoryID, rec.DiffKind, rec.Channel, rec.Status, rec.Attempts, rec.DedupKey)
	return err
}

// CheckDedup returns true if a delivery with this dedup_key+channel already succeeded.
func (d *DB) CheckDedup(ctx context.Context, dedupKey, channel string) (bool, error) {
	var exists bool
	err := d.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM notification_delivery_log
			WHERE dedup_key = $1 AND channel = $2 AND status = 'delivered'
		)`, dedupKey, channel).Scan(&exists)
	return exists, err
}

// UpdateDeliveryStatus updates the status of a delivery log entry.
func (d *DB) UpdateDeliveryStatus(ctx context.Context, id uuid.UUID, status string) error {
	now := time.Now()
	_, err := d.Pool.Exec(ctx, `
		UPDATE notification_delivery_log
		SET status = $1, last_attempt_at = $2, attempts = attempts + 1,
		    delivered_at = CASE WHEN $1 = 'delivered' THEN $2 ELSE delivered_at END
		WHERE id = $3`, status, now, id)
	return err
}

// GetTargetName returns the name of a target by ID.
func (d *DB) GetTargetName(ctx context.Context, targetID uuid.UUID) (string, error) {
	var name string
	err := d.Pool.QueryRow(ctx, `SELECT name FROM targets WHERE id = $1`, targetID).Scan(&name)
	return name, err
}

// GetTargetProjectID returns the project ID for a target.
func (d *DB) GetTargetProjectID(ctx context.Context, targetID uuid.UUID) (uuid.UUID, error) {
	var projectID uuid.UUID
	err := d.Pool.QueryRow(ctx, `SELECT project_id FROM targets WHERE id = $1`, targetID).Scan(&projectID)
	return projectID, err
}

// GetFixVersions returns fix versions for a vulnerability instance.
func (d *DB) GetFixVersions(ctx context.Context, instanceID uuid.UUID) ([]string, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT fixed_version FROM advisory_fix_versions WHERE instance_id = $1`,
		instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}
