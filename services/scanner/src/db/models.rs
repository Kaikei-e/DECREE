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

/// Parameters for inserting a new vulnerability observation.
pub struct NewObservation<'a> {
    pub instance_id: Uuid,
    pub scan_id: Uuid,
    pub cvss_score: Option<f32>,
    pub cvss_vector: Option<&'a str>,
    pub epss_score: Option<f32>,
    pub epss_percentile: Option<f32>,
    pub decree_score: Option<f32>,
    pub severity: &'a str,
    pub reachability: Option<f32>,
    pub is_direct_dep: Option<bool>,
    pub dep_depth: Option<i32>,
}
