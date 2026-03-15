use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
pub struct Target {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub target_type: String,
    pub source_ref: Option<String>,
    pub branch: Option<String>,
    pub subpath: Option<String>,
    pub exposure_class: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ScanJob {
    pub id: Uuid,
    pub target_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct Scan {
    pub id: Uuid,
    pub target_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub status: String,
    pub sbom_hash: Option<String>,
}
