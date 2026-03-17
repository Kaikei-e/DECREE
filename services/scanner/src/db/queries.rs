use chrono::Utc;
use uuid::Uuid;

use super::models::{NewObservation, ScanJob, Target};

pub async fn get_scan_job<'e, E>(executor: E, job_id: Uuid) -> sqlx::Result<ScanJob>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_as::<_, ScanJob>("SELECT * FROM scan_jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(executor)
        .await
}

pub async fn get_target<'e, E>(executor: E, target_id: Uuid) -> sqlx::Result<Target>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_as::<_, Target>("SELECT * FROM targets WHERE id = $1")
        .bind(target_id)
        .fetch_one(executor)
        .await
}

pub async fn update_scan_job_status<'e, E>(
    executor: E,
    job_id: Uuid,
    status: &str,
    error_message: Option<&str>,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let now = Utc::now();
    match status {
        "running" => {
            sqlx::query("UPDATE scan_jobs SET status = $2, started_at = $3 WHERE id = $1")
                .bind(job_id)
                .bind(status)
                .bind(now)
                .execute(executor)
                .await?;
        }
        "completed" | "failed" => {
            sqlx::query(
                "UPDATE scan_jobs SET status = $2, completed_at = $3, error_message = $4 WHERE id = $1",
            )
            .bind(job_id)
            .bind(status)
            .bind(now)
            .bind(error_message)
            .execute(executor)
            .await?;
        }
        _ => {
            sqlx::query("UPDATE scan_jobs SET status = $2 WHERE id = $1")
                .bind(job_id)
                .bind(status)
                .execute(executor)
                .await?;
        }
    }
    Ok(())
}

pub async fn insert_scan<'e, E>(executor: E, target_id: Uuid) -> sqlx::Result<Uuid>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let row: (Uuid,) =
        sqlx::query_as("INSERT INTO scans (target_id, status) VALUES ($1, 'running') RETURNING id")
            .bind(target_id)
            .fetch_one(executor)
            .await?;
    Ok(row.0)
}

pub async fn complete_scan<'e, E>(executor: E, scan_id: Uuid, sbom_hash: &str) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "UPDATE scans SET status = 'completed', completed_at = now(), sbom_hash = $2 WHERE id = $1",
    )
    .bind(scan_id)
    .bind(sbom_hash)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn fail_scan<'e, E>(executor: E, scan_id: Uuid, error: &str) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "UPDATE scans SET status = 'failed', completed_at = now(), sbom_hash = $2 WHERE id = $1",
    )
    .bind(scan_id)
    .bind(error)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn upsert_vulnerability_instance<'e, E>(
    executor: E,
    target_id: Uuid,
    package_name: &str,
    package_version: &str,
    ecosystem: &str,
    advisory_id: &str,
    advisory_source: &str,
) -> sqlx::Result<Uuid>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO vulnerability_instances
            (target_id, package_name, package_version, ecosystem, advisory_id, advisory_source)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (target_id, package_name, package_version, ecosystem, advisory_id)
        DO UPDATE SET advisory_source = EXCLUDED.advisory_source
        RETURNING id
        "#,
    )
    .bind(target_id)
    .bind(package_name)
    .bind(package_version)
    .bind(ecosystem)
    .bind(advisory_id)
    .bind(advisory_source)
    .fetch_one(executor)
    .await?;
    Ok(row.0)
}

pub async fn insert_vulnerability_observation<'e, E>(
    executor: E,
    obs: &NewObservation<'_>,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        r#"
        INSERT INTO vulnerability_observations
            (instance_id, scan_id, cvss_score, cvss_vector, epss_score, epss_percentile, decree_score, severity, reachability, is_direct_dep, dep_depth)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        "#,
    )
    .bind(obs.instance_id)
    .bind(obs.scan_id)
    .bind(obs.cvss_score)
    .bind(obs.cvss_vector)
    .bind(obs.epss_score)
    .bind(obs.epss_percentile)
    .bind(obs.decree_score)
    .bind(obs.severity)
    .bind(obs.reachability)
    .bind(obs.is_direct_dep)
    .bind(obs.dep_depth)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn insert_advisory_fix_version<'e, E>(
    executor: E,
    instance_id: Uuid,
    version: &str,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "INSERT INTO advisory_fix_versions (instance_id, fixed_version) VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(instance_id)
    .bind(version)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn upsert_advisory<'e, E>(
    executor: E,
    advisory_id: &str,
    source: &str,
    raw_json: &serde_json::Value,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        r#"
        INSERT INTO advisories (advisory_id, source, raw_json, fetched_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (advisory_id, source) DO UPDATE SET
            raw_json = EXCLUDED.raw_json,
            fetched_at = now()
        "#,
    )
    .bind(advisory_id)
    .bind(source)
    .bind(raw_json)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn insert_advisory_alias<'e, E>(
    executor: E,
    advisory_id: &str,
    alias: &str,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        r#"
        INSERT INTO advisory_aliases (advisory_id, alias)
        VALUES ($1, $2)
        ON CONFLICT (advisory_id, alias) DO NOTHING
        "#,
    )
    .bind(advisory_id)
    .bind(alias)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn insert_dependency_edge<'e, E>(
    executor: E,
    scan_id: Uuid,
    target_id: Uuid,
    from_pkg: &str,
    to_pkg: &str,
    dep_type: &str,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "INSERT INTO dependency_edges (scan_id, target_id, from_pkg, to_pkg, dep_type)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(scan_id)
    .bind(target_id)
    .bind(from_pkg)
    .bind(to_pkg)
    .bind(dep_type)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn upsert_current_finding_status<'e, E>(
    executor: E,
    instance_id: Uuid,
    target_id: Uuid,
    scan_id: Uuid,
    is_active: bool,
    score: Option<f32>,
    severity: &str,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        r#"
        INSERT INTO current_finding_status
            (instance_id, target_id, latest_scan_id, is_active, last_observed_at, last_score, last_severity, updated_at)
        VALUES ($1, $2, $3, $4, now(), $5, $6, now())
        ON CONFLICT (instance_id) DO UPDATE SET
            latest_scan_id = EXCLUDED.latest_scan_id,
            is_active = EXCLUDED.is_active,
            last_observed_at = EXCLUDED.last_observed_at,
            last_score = EXCLUDED.last_score,
            last_severity = EXCLUDED.last_severity,
            updated_at = now()
        "#,
    )
    .bind(instance_id)
    .bind(target_id)
    .bind(scan_id)
    .bind(is_active)
    .bind(score)
    .bind(severity)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn insert_outbox_event<'e, E>(
    executor: E,
    stream_name: &str,
    payload: &serde_json::Value,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query("INSERT INTO stream_outbox (stream_name, payload) VALUES ($1, $2)")
        .bind(stream_name)
        .bind(payload)
        .execute(executor)
        .await?;
    Ok(())
}

/// Create a new scan_job and return its ID.
pub async fn insert_scan_job<'e, E>(executor: E, target_id: Uuid) -> sqlx::Result<Uuid>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let row: (Uuid,) = sqlx::query_as("INSERT INTO scan_jobs (target_id) VALUES ($1) RETURNING id")
        .bind(target_id)
        .fetch_one(executor)
        .await?;
    Ok(row.0)
}

/// Fetch the latest EPSS score and percentile for a CVE ID.
pub async fn get_latest_epss<'e, E>(executor: E, cve_id: &str) -> sqlx::Result<Option<(f32, f32)>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_as(
        "SELECT epss_score, epss_percentile FROM advisory_epss_snapshots WHERE cve_id = $1 ORDER BY epss_date DESC LIMIT 1",
    )
    .bind(cve_id)
    .fetch_optional(executor)
    .await
}
