use thiserror::Error;

#[derive(Debug, Error)]
pub enum ScannerError {
    #[error("target access failed: {0}")]
    TargetAccess(String),

    #[error("syft execution failed: {0}")]
    SyftExecution(String),

    #[error("SBOM parse failed: {0}")]
    SbomParse(String),

    #[error("OSV API error: {0}")]
    OsvApi(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("NVD API error: {0}")]
    NvdApi(String),

    #[error("EPSS API error: {0}")]
    EpssApi(String),

    #[error("Exploit-DB error: {0}")]
    ExploitDb(String),
}

pub type Result<T> = std::result::Result<T, ScannerError>;
