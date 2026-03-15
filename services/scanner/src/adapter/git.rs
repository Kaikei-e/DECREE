use std::path::Path;

use sha2::{Digest, Sha256};
use tracing::info;

use crate::db::models::Target;
use crate::error::{Result, ScannerError};
use crate::sbom::model::NormalizedSbom;

pub struct GitTargetAdapter;

impl GitTargetAdapter {
    pub async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        let url = target
            .source_ref
            .as_deref()
            .ok_or_else(|| ScannerError::TargetAccess("git target missing source_ref".into()))?;
        let branch = target.branch.as_deref().unwrap_or("main");

        info!(url, branch, "cloning git repository");

        let output = tokio::process::Command::new("git")
            .args(["clone", "--depth", "1", "--branch", branch, url])
            .arg(work_dir.join("repo"))
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ScannerError::TargetAccess(format!(
                "git clone failed: {stderr}"
            )));
        }

        Ok(())
    }

    pub async fn materialize_sbom(
        &self,
        target: &Target,
        work_dir: &Path,
    ) -> Result<NormalizedSbom> {
        let repo_dir = work_dir.join("repo");
        let scan_dir = if let Some(subpath) = &target.subpath {
            repo_dir.join(subpath)
        } else {
            repo_dir
        };

        info!(dir = %scan_dir.display(), "running syft on git repo");

        let output = tokio::process::Command::new("syft")
            .arg(scan_dir.to_str().unwrap_or("."))
            .args(["-o", "cyclonedx-json", "--quiet"])
            .output()
            .await
            .map_err(|e| ScannerError::SyftExecution(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ScannerError::SyftExecution(format!(
                "syft failed: {stderr}"
            )));
        }

        crate::sbom::cyclonedx::parse_cyclonedx(&output.stdout)
    }

    pub async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String> {
        let output = tokio::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(work_dir.join("repo"))
            .output()
            .await?;

        let rev = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let url = target.source_ref.as_deref().unwrap_or("");
        let branch = target.branch.as_deref().unwrap_or("main");

        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        hasher.update(branch.as_bytes());
        hasher.update(rev.as_bytes());
        Ok(hex::encode(hasher.finalize()))
    }
}
