use sqlx::PgPool;
use tracing::info;

use crate::error::{Result, ScannerError};
use super::score;

pub struct ProjectionUpdater {
    pool: PgPool,
}

#[derive(Debug, sqlx::FromRow)]
struct FindingRow {
    instance_id: uuid::Uuid,
    #[allow(dead_code)]
    target_id: uuid::Uuid,
    advisory_id: String,
    exposure_class: Option<String>,
    is_direct_dep: Option<bool>,
    dep_depth: Option<i32>,
    cvss_score: Option<f32>,
}

impl ProjectionUpdater {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Recalculate DECREE scores for all active findings.
    pub async fn recalculate_all(&self) -> Result<u32> {
        let findings = self.load_active_findings(None).await?;
        self.recalculate_findings(&findings).await
    }

    /// Recalculate DECREE scores for findings matching the given CVE IDs.
    pub async fn recalculate_for_cves(&self, cve_ids: &[String]) -> Result<u32> {
        let findings = self.load_active_findings(Some(cve_ids)).await?;
        self.recalculate_findings(&findings).await
    }

    async fn load_active_findings(&self, cve_filter: Option<&[String]>) -> Result<Vec<FindingRow>> {
        let rows = if let Some(cves) = cve_filter {
            sqlx::query_as::<_, FindingRow>(
                r#"
                SELECT
                    cfs.instance_id,
                    cfs.target_id,
                    vi.advisory_id,
                    t.exposure_class,
                    vo.is_direct_dep,
                    vo.dep_depth,
                    vo.cvss_score
                FROM current_finding_status cfs
                JOIN vulnerability_instances vi ON vi.id = cfs.instance_id
                JOIN targets t ON t.id = cfs.target_id
                LEFT JOIN LATERAL (
                    SELECT is_direct_dep, dep_depth, cvss_score
                    FROM vulnerability_observations
                    WHERE instance_id = cfs.instance_id
                    ORDER BY observed_at DESC
                    LIMIT 1
                ) vo ON true
                WHERE cfs.is_active = true
                  AND vi.advisory_id = ANY($1)
                "#,
            )
            .bind(cves)
            .fetch_all(&self.pool)
            .await
            .map_err(ScannerError::Database)?
        } else {
            sqlx::query_as::<_, FindingRow>(
                r#"
                SELECT
                    cfs.instance_id,
                    cfs.target_id,
                    vi.advisory_id,
                    t.exposure_class,
                    vo.is_direct_dep,
                    vo.dep_depth,
                    vo.cvss_score
                FROM current_finding_status cfs
                JOIN vulnerability_instances vi ON vi.id = cfs.instance_id
                JOIN targets t ON t.id = cfs.target_id
                LEFT JOIN LATERAL (
                    SELECT is_direct_dep, dep_depth, cvss_score
                    FROM vulnerability_observations
                    WHERE instance_id = cfs.instance_id
                    ORDER BY observed_at DESC
                    LIMIT 1
                ) vo ON true
                WHERE cfs.is_active = true
                "#,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(ScannerError::Database)?
        };

        Ok(rows)
    }

    async fn recalculate_findings(&self, findings: &[FindingRow]) -> Result<u32> {
        let mut updated = 0u32;

        for finding in findings {
            // Look up latest EPSS
            let epss: Option<(f32,)> = sqlx::query_as(
                r#"
                SELECT epss_score
                FROM advisory_epss_snapshots
                WHERE cve_id = $1
                ORDER BY epss_date DESC
                LIMIT 1
                "#,
            )
            .bind(&finding.advisory_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(ScannerError::Database)?;

            let epss_score = epss.map(|e| e.0);

            // Check for exploit existence (bonus reachability signal — not in formula but useful for severity)
            let _has_exploit: bool = sqlx::query_as::<_, (bool,)>(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM exploit_cve_links WHERE cve_id = $1
                )
                "#,
            )
            .bind(&finding.advisory_id)
            .fetch_one(&self.pool)
            .await
            .map_err(ScannerError::Database)?
            .0;

            // Compute reachability
            let reachability = score::reachability_score(
                finding.exposure_class.as_deref(),
                finding.is_direct_dep.unwrap_or(false),
                finding.dep_depth.unwrap_or(0) as u32,
            );

            // Compute DECREE Score
            let new_score = score::decree_score(finding.cvss_score, epss_score, reachability);
            let new_severity = score::severity_label(finding.cvss_score);

            // Update projection
            sqlx::query(
                r#"
                UPDATE current_finding_status
                SET last_score = $2,
                    last_severity = $3,
                    updated_at = now()
                WHERE instance_id = $1
                "#,
            )
            .bind(finding.instance_id)
            .bind(new_score)
            .bind(new_severity)
            .execute(&self.pool)
            .await
            .map_err(ScannerError::Database)?;

            updated += 1;
        }

        // Publish outbox event
        if updated > 0 {
            let _ = sqlx::query(
                "INSERT INTO stream_outbox (stream_name, payload) VALUES ($1, $2)",
            )
            .bind("enrichment-events")
            .bind(serde_json::json!({
                "type": "scores.recalculated",
                "updated_count": updated,
            }))
            .execute(&self.pool)
            .await;
        }

        info!(updated, "projection recalculation complete");
        Ok(updated)
    }
}
