use std::path::Path;

use sha2::{Digest, Sha256};
use tracing::info;

use crate::db::models::Target;
use crate::error::{Result, ScannerError};
use crate::sbom::detect::parse_sbom;
use crate::sbom::model::NormalizedSbom;

pub struct SbomTargetAdapter;

impl SbomTargetAdapter {
    pub async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        let source = target
            .source_ref
            .as_deref()
            .ok_or_else(|| ScannerError::TargetAccess("sbom target missing source_ref".into()))?;

        // If source looks like a URL, fetch it
        if source.starts_with("http://") || source.starts_with("https://") {
            info!(url = source, "fetching SBOM from URL");
            let resp = reqwest::get(source)
                .await
                .map_err(|e| ScannerError::TargetAccess(e.to_string()))?;

            if !resp.status().is_success() {
                return Err(ScannerError::TargetAccess(format!(
                    "HTTP {} fetching SBOM",
                    resp.status()
                )));
            }

            let bytes = resp
                .bytes()
                .await
                .map_err(|e| ScannerError::TargetAccess(e.to_string()))?;

            let dest = work_dir.join("sbom.json");
            tokio::fs::write(&dest, &bytes).await?;
        } else {
            // Local file — copy to work_dir for uniform handling
            let dest = work_dir.join("sbom.json");
            tokio::fs::copy(source, &dest).await.map_err(|e| {
                ScannerError::TargetAccess(format!("failed to copy SBOM file: {e}"))
            })?;
        }

        Ok(())
    }

    pub async fn materialize_sbom(
        &self,
        _target: &Target,
        work_dir: &Path,
    ) -> Result<NormalizedSbom> {
        let path = work_dir.join("sbom.json");
        let data = tokio::fs::read(&path).await?;
        parse_sbom(&data)
    }

    pub async fn fingerprint(&self, _target: &Target, work_dir: &Path) -> Result<String> {
        let path = work_dir.join("sbom.json");
        let data = tokio::fs::read(&path).await?;
        let mut hasher = Sha256::new();
        hasher.update(&data);
        Ok(hex::encode(hasher.finalize()))
    }
}
