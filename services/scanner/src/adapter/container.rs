use std::path::Path;

use tracing::info;

use crate::db::models::Target;
use crate::error::{Result, ScannerError};
use crate::sbom::model::NormalizedSbom;

pub struct ContainerTargetAdapter;

impl ContainerTargetAdapter {
    pub async fn prepare(&self, _target: &Target, _work_dir: &Path) -> Result<()> {
        // No preparation needed for container images — syft pulls directly.
        Ok(())
    }

    pub async fn materialize_sbom(
        &self,
        target: &Target,
        _work_dir: &Path,
    ) -> Result<NormalizedSbom> {
        let image = target.source_ref.as_deref().ok_or_else(|| {
            ScannerError::TargetAccess("container target missing source_ref (image)".into())
        })?;

        info!(image, "running syft on container image");

        let output = tokio::process::Command::new("syft")
            .arg(image)
            .args(["-o", "cyclonedx-json", "--quiet"])
            .output()
            .await
            .map_err(|e| ScannerError::SyftExecution(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ScannerError::SyftExecution(format!(
                "syft failed on image {image}: {stderr}"
            )));
        }

        crate::sbom::cyclonedx::parse_cyclonedx(&output.stdout)
    }

    pub async fn fingerprint(&self, target: &Target, _work_dir: &Path) -> Result<String> {
        // Use the image reference as fingerprint. In production, we'd resolve the digest.
        let image = target.source_ref.as_deref().unwrap_or("unknown");
        Ok(image.to_string())
    }
}
