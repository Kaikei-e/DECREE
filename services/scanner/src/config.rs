use crate::error::{Result, ScannerError};

#[derive(Debug, Clone)]
pub struct ScannerConfig {
    pub database_url: String,
    pub redis_url: String,
    pub listen_addr: String,
    pub nvd_api_key: Option<String>,
    pub exploitdb_repo_path: Option<String>,
}

impl ScannerConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            database_url: std::env::var("DATABASE_URL")
                .map_err(|_| ScannerError::Config("DATABASE_URL must be set".into()))?,
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            listen_addr: std::env::var("LISTEN_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:9000".to_string()),
            nvd_api_key: std::env::var("NVD_API_KEY").ok(),
            exploitdb_repo_path: std::env::var("EXPLOITDB_REPO_PATH").ok(),
        })
    }
}
