use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use super::models::{ScanJob, Target};
use crate::sbom::model::DependencyEdge;

pub async fn get_scan_job(pool: &PgPool, job_id: Uuid) -> sqlx::Result<ScanJob> {
    sqlx::query_as::<_, ScanJob>("SELECT * FROM scan_jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(pool)
        .await
}

pub async fn get_target(pool: &PgPool, target_id: Uuid) -> sqlx::Result<Target> {
    sqlx::query_as::<_, Target>("SELECT * FROM targets WHERE id = $1")
        .bind(target_id)
        .fetch_one(pool)
        .await
}

pub async fn update_scan_job_status(
    pool: &PgPool,
    job_id: Uuid,
    status: &str,
    error_message: Option<&str>,
) -> sqlx::Result<()> {
    let now = Utc::now();
    match status {
        "running" => {
            sqlx::query(
                "UPDATE scan_jobs SET status = $2, started_at = $3 WHERE id = $1",
            )
            .bind(job_id)
            .bind(status)
            .bind(now)
            .execute(pool)
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
            .execute(pool)
            .await?;
        }
        _ => {
            sqlx::query("UPDATE scan_jobs SET status = $2 WHERE id = $1")
                .bind(job_id)
                .bind(status)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

pub async fn insert_scan(pool: &PgPool, target_id: Uuid) -> sqlx::Result<Uuid> {
    let row: (Uuid,) = sqlx::query_as(
        "INSERT INTO scans (target_id, status) VALUES ($1, 'running') RETURNING id",
    )
    .bind(target_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn complete_scan(
    pool: &PgPool,
    scan_id: Uuid,
    sbom_hash: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE scans SET status = 'completed', completed_at = now(), sbom_hash = $2 WHERE id = $1",
    )
    .bind(scan_id)
    .bind(sbom_hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn fail_scan(pool: &PgPool, scan_id: Uuid, error: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE scans SET status = 'failed', completed_at = now(), sbom_hash = $2 WHERE id = $1",
    )
    .bind(scan_id)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn upsert_vulnerability_instance(
    pool: &PgPool,
    target_id: Uuid,
    package_name: &str,
    package_version: &str,
    ecosystem: &str,
    advisory_id: &str,
    advisory_source: &str,
) -> sqlx::Result<Uuid> {
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
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_vulnerability_observation(
    pool: &PgPool,
    instance_id: Uuid,
    scan_id: Uuid,
    cvss_score: Option<f32>,
    cvss_vector: Option<&str>,
    decree_score: Option<f32>,
    severity: &str,
    is_direct_dep: Option<bool>,
    dep_depth: Option<i32>,
) -> sqlx::Result<Uuid> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO vulnerability_observations
            (instance_id, scan_id, cvss_score, cvss_vector, decree_score, severity, is_direct_dep, dep_depth)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        "#,
    )
    .bind(instance_id)
    .bind(scan_id)
    .bind(cvss_score)
    .bind(cvss_vector)
    .bind(decree_score)
    .bind(severity)
    .bind(is_direct_dep)
    .bind(dep_depth)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn insert_advisory_fix_versions(
    pool: &PgPool,
    instance_id: Uuid,
    versions: &[String],
) -> sqlx::Result<()> {
    for version in versions {
        sqlx::query(
            "INSERT INTO advisory_fix_versions (instance_id, fixed_version) VALUES ($1, $2)
             ON CONFLICT DO NOTHING",
        )
        .bind(instance_id)
        .bind(version)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn insert_dependency_edges(
    pool: &PgPool,
    scan_id: Uuid,
    target_id: Uuid,
    edges: &[DependencyEdge],
) -> sqlx::Result<()> {
    for edge in edges {
        sqlx::query(
            "INSERT INTO dependency_edges (scan_id, target_id, from_pkg, to_pkg, dep_type)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(scan_id)
        .bind(target_id)
        .bind(&edge.from_pkg)
        .bind(&edge.to_pkg)
        .bind(&edge.dep_type)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn upsert_current_finding_status(
    pool: &PgPool,
    instance_id: Uuid,
    target_id: Uuid,
    scan_id: Uuid,
    is_active: bool,
    score: Option<f32>,
    severity: &str,
) -> sqlx::Result<()> {
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
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_outbox_event(
    pool: &PgPool,
    stream_name: &str,
    payload: &serde_json::Value,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO stream_outbox (stream_name, payload) VALUES ($1, $2)",
    )
    .bind(stream_name)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

/// Create a new scan_job and return its ID.
pub async fn insert_scan_job(pool: &PgPool, target_id: Uuid) -> sqlx::Result<Uuid> {
    let row: (Uuid,) = sqlx::query_as(
        "INSERT INTO scan_jobs (target_id) VALUES ($1) RETURNING id",
    )
    .bind(target_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}
