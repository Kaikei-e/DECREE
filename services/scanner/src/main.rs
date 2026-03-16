use std::sync::Arc;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use tokio_util::sync::CancellationToken;
use tracing::info;

use decree_scanner::config::ScannerConfig;
use decree_scanner::connect::handler::connect_response;
use decree_scanner::enrichment::epss::client::EpssClient;
use decree_scanner::enrichment::nvd::client::NvdClient;
use decree_scanner::osv::client::OsvClient;
use decree_scanner::outbox::OutboxPublisher;
use decree_scanner::rpc::service::{EnrichmentRpcService, ScannerRpcService};
use decree_scanner::scan::pipeline::ScanPipeline;

#[derive(Clone)]
struct AppState {
    scanner: Arc<ScannerRpcService>,
    enrichment: Arc<EnrichmentRpcService>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "decree-scanner",
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = ScannerConfig::from_env()?;

    // Database pool
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    info!("connected to PostgreSQL");

    // OSV client
    let osv = OsvClient::new();

    // Scan pipeline
    let pipeline = Arc::new(ScanPipeline::new(pool.clone(), osv, EpssClient::new()));

    // RPC services
    let scanner_service = ScannerRpcService::new(pool.clone(), Arc::clone(&pipeline));

    let epss_client = EpssClient::new();
    let nvd_client = NvdClient::new(config.nvd_api_key.clone());
    let enrichment_service = EnrichmentRpcService::new(
        pool.clone(),
        epss_client,
        nvd_client,
        config.exploitdb_repo_path.clone(),
    );

    // Outbox publisher (background task)
    let cancel = CancellationToken::new();
    let outbox = OutboxPublisher::new(pool.clone(), config.redis_url.clone());
    let outbox_cancel = cancel.clone();
    tokio::spawn(async move {
        outbox.run(outbox_cancel).await;
    });

    let state = AppState {
        scanner: Arc::new(scanner_service),
        enrichment: Arc::new(enrichment_service),
    };

    // Build Connect-RPC router
    let app = Router::new()
        .route("/healthz", get(healthz))
        // ScannerService
        .route(
            "/scanner.v1.ScannerService/RunScan",
            post(|State(s): State<AppState>, Json(req)| async move {
                connect_response(s.scanner.run_scan(req).await)
            }),
        )
        .route(
            "/scanner.v1.ScannerService/GetScanStatus",
            post(|State(s): State<AppState>, Json(req)| async move {
                connect_response(s.scanner.get_scan_status(req).await)
            }),
        )
        // EnrichmentService
        .route(
            "/scanner.v1.EnrichmentService/SyncEpss",
            post(|State(s): State<AppState>, Json(req)| async move {
                connect_response(s.enrichment.sync_epss(req).await)
            }),
        )
        .route(
            "/scanner.v1.EnrichmentService/SyncNvd",
            post(|State(s): State<AppState>, Json(req)| async move {
                connect_response(s.enrichment.sync_nvd(req).await)
            }),
        )
        .route(
            "/scanner.v1.EnrichmentService/SyncExploitDb",
            post(|State(s): State<AppState>, Json(req)| async move {
                connect_response(s.enrichment.sync_exploit_db(req).await)
            }),
        )
        .route(
            "/scanner.v1.EnrichmentService/RecalculateScores",
            post(|State(s): State<AppState>, Json(req)| async move {
                connect_response(s.enrichment.recalculate_scores(req).await)
            }),
        )
        .with_state(state);

    let addr: std::net::SocketAddr = config.listen_addr.parse()?;
    info!("decree-scanner listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let cancel_for_shutdown = cancel.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            info!("received SIGINT, shutting down");
            cancel_for_shutdown.cancel();
        })
        .await?;

    Ok(())
}
