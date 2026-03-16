use std::sync::Arc;

use sqlx::PgPool;
use tracing::{error, info};
use uuid::Uuid;

use crate::connect::error::{ConnectCode, ConnectError};
use crate::db::queries;
use crate::enrichment::epss::client::EpssClient;
use crate::enrichment::exploitdb::sync::ExploitDbSync;
use crate::enrichment::nvd::client::NvdClient;
use crate::enrichment::projection::ProjectionUpdater;
use crate::scan::pipeline::ScanPipeline;

use super::proto::{
    GetScanStatusRequest, GetScanStatusResponse, RecalculateScoresRequest,
    RecalculateScoresResponse, RunScanRequest, RunScanResponse, SyncEpssRequest, SyncEpssResponse,
    SyncExploitDbRequest, SyncExploitDbResponse, SyncNvdRequest, SyncNvdResponse,
};

// ── Scanner Service ─────────────────────────────────────────

pub struct ScannerRpcService {
    pool: PgPool,
    pipeline: Arc<ScanPipeline>,
}

impl ScannerRpcService {
    pub fn new(pool: PgPool, pipeline: Arc<ScanPipeline>) -> Self {
        Self { pool, pipeline }
    }

    pub async fn run_scan(&self, req: RunScanRequest) -> Result<RunScanResponse, ConnectError> {
        let target_id: Uuid = req.target_id.parse().map_err(|_| ConnectError {
            code: ConnectCode::InvalidArgument,
            message: "invalid target_id UUID".to_string(),
        })?;

        // Create a scan job
        let job_id = queries::insert_scan_job(&self.pool, target_id)
            .await
            .map_err(|e| ConnectError {
                code: ConnectCode::Internal,
                message: format!("failed to create scan job: {e}"),
            })?;

        info!(job_id = %job_id, target_id = %target_id, "scan job created, spawning pipeline");

        // Fire-and-forget — pipeline runs in background
        let pipeline = Arc::clone(&self.pipeline);
        tokio::spawn(async move {
            if let Err(e) = pipeline.execute(job_id).await {
                error!(job_id = %job_id, error = %e, "scan pipeline failed");
            }
        });

        Ok(RunScanResponse {
            scan_id: job_id.to_string(),
            status: "pending".to_string(),
        })
    }

    pub async fn get_scan_status(
        &self,
        req: GetScanStatusRequest,
    ) -> Result<GetScanStatusResponse, ConnectError> {
        let job_id: Uuid = req.scan_id.parse().map_err(|_| ConnectError {
            code: ConnectCode::InvalidArgument,
            message: "invalid scan_id UUID".to_string(),
        })?;

        // Keep explicit mapping for NotFound vs Internal
        let job = queries::get_scan_job(&self.pool, job_id)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ConnectError {
                    code: ConnectCode::NotFound,
                    message: "scan job not found".to_string(),
                },
                other => ConnectError {
                    code: ConnectCode::Internal,
                    message: format!("database error: {other}"),
                },
            })?;

        Ok(GetScanStatusResponse {
            scan_id: job.id.to_string(),
            status: job.status,
            started_at: job.started_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
            completed_at: job.completed_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
            error_message: job.error_message.unwrap_or_default(),
        })
    }
}

// ── Enrichment Service ──────────────────────────────────────

pub struct EnrichmentRpcService {
    pool: PgPool,
    epss: EpssClient,
    nvd: NvdClient,
    exploitdb_repo_path: Option<String>,
}

impl EnrichmentRpcService {
    pub fn new(
        pool: PgPool,
        epss: EpssClient,
        nvd: NvdClient,
        exploitdb_repo_path: Option<String>,
    ) -> Self {
        Self {
            pool,
            epss,
            nvd,
            exploitdb_repo_path,
        }
    }

    pub async fn sync_epss(&self, _req: SyncEpssRequest) -> Result<SyncEpssResponse, ConnectError> {
        info!("EnrichmentService: SyncEpss called");
        let count = self.epss.sync_known_cves(&self.pool).await?;
        Ok(SyncEpssResponse {
            synced_count: count,
        })
    }

    pub async fn sync_nvd(&self, _req: SyncNvdRequest) -> Result<SyncNvdResponse, ConnectError> {
        info!("EnrichmentService: SyncNvd called");
        let count = self.nvd.sync_known_cves(&self.pool).await?;
        Ok(SyncNvdResponse {
            synced_count: count,
        })
    }

    pub async fn sync_exploit_db(
        &self,
        _req: SyncExploitDbRequest,
    ) -> Result<SyncExploitDbResponse, ConnectError> {
        info!("EnrichmentService: SyncExploitDb called");
        let sync = ExploitDbSync::new(self.exploitdb_repo_path.as_deref());
        let (exploits, links) = sync.run(&self.pool).await?;
        Ok(SyncExploitDbResponse {
            exploits_synced: exploits,
            links_synced: links,
        })
    }

    pub async fn recalculate_scores(
        &self,
        req: RecalculateScoresRequest,
    ) -> Result<RecalculateScoresResponse, ConnectError> {
        info!(
            cve_count = req.cve_ids.len(),
            "EnrichmentService: RecalculateScores called"
        );
        let updater = ProjectionUpdater::new(self.pool.clone());
        let count = if req.cve_ids.is_empty() {
            updater.recalculate_all().await
        } else {
            updater.recalculate_for_cves(&req.cve_ids).await
        }?;
        Ok(RecalculateScoresResponse {
            updated_count: count,
        })
    }
}
