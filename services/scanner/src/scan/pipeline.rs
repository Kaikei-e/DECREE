use sqlx::PgPool;
use tracing::{error, info};
use uuid::Uuid;

use crate::adapter::TargetAdapter;
use crate::db::queries;
use crate::enrichment::score;
use crate::error::{Result, ScannerError};
use crate::osv::client::{advisory_source, OsvClient};

pub struct ScanPipeline {
    pool: PgPool,
    osv: OsvClient,
}

impl ScanPipeline {
    pub fn new(pool: PgPool, osv: OsvClient) -> Self {
        Self { pool, osv }
    }

    /// Execute a full scan pipeline for the given job.
    /// Returns the scan_id on success.
    pub async fn execute(&self, job_id: Uuid) -> Result<Uuid> {
        // 1. Load job + target
        let job = queries::get_scan_job(&self.pool, job_id)
            .await
            .map_err(ScannerError::Database)?;
        let target = queries::get_target(&self.pool, job.target_id)
            .await
            .map_err(ScannerError::Database)?;

        // 2. Mark job as running
        queries::update_scan_job_status(&self.pool, job_id, "running", None)
            .await
            .map_err(ScannerError::Database)?;

        // 3. Insert scan record
        let scan_id = queries::insert_scan(&self.pool, target.id)
            .await
            .map_err(ScannerError::Database)?;

        // Run the core pipeline, capturing errors for proper cleanup
        match self.run_core(scan_id, &target, job_id).await {
            Ok(()) => {
                info!(scan_id = %scan_id, job_id = %job_id, "scan completed successfully");
                Ok(scan_id)
            }
            Err(e) => {
                error!(scan_id = %scan_id, job_id = %job_id, error = %e, "scan failed");
                let err_msg = e.to_string();
                let _ = queries::fail_scan(&self.pool, scan_id, &err_msg).await;
                let _ = queries::update_scan_job_status(
                    &self.pool,
                    job_id,
                    "failed",
                    Some(&err_msg),
                )
                .await;

                // Publish failure event
                let _ = queries::insert_outbox_event(
                    &self.pool,
                    "scan-events",
                    &serde_json::json!({
                        "type": "scan.failed",
                        "scan_id": scan_id,
                        "target_id": target.id,
                        "error": err_msg,
                    }),
                )
                .await;

                Err(e)
            }
        }
    }

    async fn run_core(
        &self,
        scan_id: Uuid,
        target: &crate::db::models::Target,
        job_id: Uuid,
    ) -> Result<()> {
        // 4. Create tempdir
        let tmp = tempfile::tempdir()?;
        let work_dir = tmp.path();

        // 5. Select adapter
        let adapter = TargetAdapter::from_target(target)?;

        // 6. Prepare (clone/fetch)
        adapter.prepare(target, work_dir).await?;

        // 7. Generate/parse SBOM
        let sbom = adapter.materialize_sbom(target, work_dir).await?;

        // 8. Fingerprint
        let fingerprint = adapter.fingerprint(target, work_dir).await?;

        info!(
            packages = sbom.packages.len(),
            edges = sbom.edges.len(),
            "SBOM materialized"
        );

        // 9. Query OSV
        let osv_results = self.osv.query_batch(&sbom.packages).await?;

        // 10. Persist findings in a transaction
        let mut tx = self.pool.begin().await.map_err(ScannerError::Database)?;
        let mut finding_count = 0u32;

        for (pkg, batch_result) in sbom.packages.iter().zip(osv_results.iter()) {
            for vuln in &batch_result.vulns {
                let advisory_id = vuln.primary_id();
                let source = advisory_source(advisory_id);
                let cvss = vuln.extract_cvss_score();
                let cvss_vector = vuln.extract_cvss_vector().map(|s| s.to_string());
                let fix_versions = vuln.extract_fix_versions();

                // Look up existing EPSS data (may be NULL if not yet enriched)
                let epss_row: Option<(f32, f32)> = sqlx::query_as(
                    "SELECT epss_score, epss_percentile FROM advisory_epss_snapshots WHERE cve_id = $1 ORDER BY epss_date DESC LIMIT 1"
                )
                .bind(advisory_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(ScannerError::Database)?;

                let epss_score = epss_row.map(|r| r.0);
                let epss_percentile = epss_row.map(|r| r.1);

                // Compute reachability from target exposure_class + dependency info
                let reachability = score::reachability_score(
                    target.exposure_class.as_deref(),
                    pkg.is_direct,
                    pkg.dep_depth,
                );

                let decree_score = score::decree_score(cvss, epss_score, reachability);
                let severity = score::severity_label(cvss);

                // a. Upsert vulnerability_instance
                let instance_id = sqlx::query_as::<_, (Uuid,)>(
                    r#"
                    INSERT INTO vulnerability_instances
                        (target_id, package_name, package_version, ecosystem, advisory_id, advisory_source)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (target_id, package_name, package_version, ecosystem, advisory_id)
                    DO UPDATE SET advisory_source = EXCLUDED.advisory_source
                    RETURNING id
                    "#,
                )
                .bind(target.id)
                .bind(&pkg.name)
                .bind(&pkg.version)
                .bind(pkg.ecosystem.as_osv_str())
                .bind(advisory_id)
                .bind(source)
                .fetch_one(&mut *tx)
                .await
                .map_err(ScannerError::Database)?
                .0;

                // b. Insert observation
                sqlx::query(
                    r#"
                    INSERT INTO vulnerability_observations
                        (instance_id, scan_id, cvss_score, cvss_vector, epss_score, epss_percentile, decree_score, severity, reachability, is_direct_dep, dep_depth)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    "#,
                )
                .bind(instance_id)
                .bind(scan_id)
                .bind(cvss)
                .bind(cvss_vector.as_deref())
                .bind(epss_score)
                .bind(epss_percentile)
                .bind(decree_score)
                .bind(severity)
                .bind(Some(reachability))
                .bind(Some(pkg.is_direct))
                .bind(Some(pkg.dep_depth as i32))
                .execute(&mut *tx)
                .await
                .map_err(ScannerError::Database)?;

                // c. Fix versions
                for fv in &fix_versions {
                    sqlx::query(
                        "INSERT INTO advisory_fix_versions (instance_id, fixed_version) VALUES ($1, $2)
                         ON CONFLICT DO NOTHING",
                    )
                    .bind(instance_id)
                    .bind(fv)
                    .execute(&mut *tx)
                    .await
                    .map_err(ScannerError::Database)?;
                }

                // e. Upsert current_finding_status
                sqlx::query(
                    r#"
                    INSERT INTO current_finding_status
                        (instance_id, target_id, latest_scan_id, is_active, last_observed_at, last_score, last_severity, updated_at)
                    VALUES ($1, $2, $3, true, now(), $4, $5, now())
                    ON CONFLICT (instance_id) DO UPDATE SET
                        latest_scan_id = EXCLUDED.latest_scan_id,
                        is_active = true,
                        last_observed_at = now(),
                        last_score = EXCLUDED.last_score,
                        last_severity = EXCLUDED.last_severity,
                        updated_at = now()
                    "#,
                )
                .bind(instance_id)
                .bind(target.id)
                .bind(scan_id)
                .bind(decree_score)
                .bind(severity)
                .execute(&mut *tx)
                .await
                .map_err(ScannerError::Database)?;

                finding_count += 1;
            }
        }

        // d. Insert dependency edges
        for edge in &sbom.edges {
            sqlx::query(
                "INSERT INTO dependency_edges (scan_id, target_id, from_pkg, to_pkg, dep_type)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(scan_id)
            .bind(target.id)
            .bind(&edge.from_pkg)
            .bind(&edge.to_pkg)
            .bind(&edge.dep_type)
            .execute(&mut *tx)
            .await
            .map_err(ScannerError::Database)?;
        }

        // f. Complete scan
        sqlx::query(
            "UPDATE scans SET status = 'completed', completed_at = now(), sbom_hash = $2 WHERE id = $1",
        )
        .bind(scan_id)
        .bind(&fingerprint)
        .execute(&mut *tx)
        .await
        .map_err(ScannerError::Database)?;

        // g. Outbox events
        sqlx::query("INSERT INTO stream_outbox (stream_name, payload) VALUES ($1, $2)")
            .bind("scan-events")
            .bind(serde_json::json!({
                "type": "scan.completed",
                "scan_id": scan_id,
                "target_id": target.id,
                "findings_count": finding_count,
            }))
            .execute(&mut *tx)
            .await
            .map_err(ScannerError::Database)?;

        tx.commit().await.map_err(ScannerError::Database)?;

        // Update job status (outside transaction — best effort)
        let _ = queries::update_scan_job_status(&self.pool, job_id, "completed", None).await;

        Ok(())
    }
}
