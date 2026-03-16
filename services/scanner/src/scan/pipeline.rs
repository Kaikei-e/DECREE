use sqlx::PgPool;
use tracing::{error, info};
use uuid::Uuid;

use crate::adapter::TargetAdapter;
use crate::db::models::NewObservation;
use crate::db::queries;
use crate::enrichment::score;
use crate::error::{Result, ScannerError};
use crate::osv::client::{OsvClient, advisory_source};

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
                let _ =
                    queries::update_scan_job_status(&self.pool, job_id, "failed", Some(&err_msg))
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
        let tmp = tempfile::tempdir()?;
        let work_dir = tmp.path();

        let adapter = TargetAdapter::from_target(target)?;
        adapter.prepare(target, work_dir).await?;
        let sbom = adapter.materialize_sbom(target, work_dir).await?;
        let fingerprint = adapter.fingerprint(target, work_dir).await?;

        info!(
            packages = sbom.packages.len(),
            edges = sbom.edges.len(),
            "SBOM materialized"
        );

        let osv_results = self.osv.query_batch(&sbom.packages).await?;

        // Persist findings in a transaction
        let mut tx = self.pool.begin().await.map_err(ScannerError::Database)?;
        let mut finding_count = 0u32;

        for (pkg, batch_result) in sbom.packages.iter().zip(osv_results.iter()) {
            for vuln in &batch_result.vulns {
                let advisory_id = vuln.primary_id();
                let source = advisory_source(advisory_id);
                let cvss = vuln.extract_cvss_score();
                let cvss_vector = vuln.extract_cvss_vector().map(|s| s.to_string());
                let fix_versions = vuln.extract_fix_versions();

                let epss_row = queries::get_latest_epss(&mut *tx, advisory_id)
                    .await
                    .map_err(ScannerError::Database)?;

                let epss_score = epss_row.map(|r| r.0);
                let epss_percentile = epss_row.map(|r| r.1);

                let reachability = score::reachability_score(
                    target.exposure_class.as_deref(),
                    pkg.is_direct,
                    pkg.dep_depth,
                );

                let decree_score = score::decree_score(cvss, epss_score, reachability);
                let severity = score::severity_label(cvss);

                let instance_id = queries::upsert_vulnerability_instance(
                    &mut *tx,
                    target.id,
                    &pkg.name,
                    &pkg.version,
                    pkg.ecosystem.as_osv_str(),
                    advisory_id,
                    source,
                )
                .await
                .map_err(ScannerError::Database)?;

                queries::insert_vulnerability_observation(
                    &mut *tx,
                    &NewObservation {
                        instance_id,
                        scan_id,
                        cvss_score: cvss,
                        cvss_vector: cvss_vector.as_deref(),
                        epss_score,
                        epss_percentile,
                        decree_score,
                        severity,
                        reachability: Some(reachability),
                        is_direct_dep: Some(pkg.is_direct),
                        dep_depth: Some(pkg.dep_depth as i32),
                    },
                )
                .await
                .map_err(ScannerError::Database)?;

                for fv in &fix_versions {
                    queries::insert_advisory_fix_version(&mut *tx, instance_id, fv)
                        .await
                        .map_err(ScannerError::Database)?;
                }

                queries::upsert_current_finding_status(
                    &mut *tx,
                    instance_id,
                    target.id,
                    scan_id,
                    true,
                    decree_score,
                    severity,
                )
                .await
                .map_err(ScannerError::Database)?;

                finding_count += 1;
            }
        }

        for edge in &sbom.edges {
            queries::insert_dependency_edge(
                &mut *tx,
                scan_id,
                target.id,
                &edge.from_pkg,
                &edge.to_pkg,
                &edge.dep_type,
            )
            .await
            .map_err(ScannerError::Database)?;
        }

        queries::complete_scan(&mut *tx, scan_id, &fingerprint)
            .await
            .map_err(ScannerError::Database)?;

        queries::insert_outbox_event(
            &mut *tx,
            "scan-events",
            &serde_json::json!({
                "type": "scan.completed",
                "scan_id": scan_id,
                "target_id": target.id,
                "findings_count": finding_count,
            }),
        )
        .await
        .map_err(ScannerError::Database)?;

        tx.commit().await.map_err(ScannerError::Database)?;

        // Update job status (outside transaction — best effort)
        let _ = queries::update_scan_job_status(&self.pool, job_id, "completed", None).await;

        Ok(())
    }
}
