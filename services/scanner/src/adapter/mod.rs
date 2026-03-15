pub mod container;
pub mod git;
pub mod sbom;

use std::path::Path;

use crate::db::models::Target;
use crate::error::{Result, ScannerError};
use crate::sbom::model::NormalizedSbom;

/// Enum dispatch adapter — the set of target types is fixed (git, container, sbom).
pub enum TargetAdapter {
    Git(git::GitTargetAdapter),
    Container(container::ContainerTargetAdapter),
    Sbom(sbom::SbomTargetAdapter),
}

impl TargetAdapter {
    pub fn from_target(target: &Target) -> Result<Self> {
        match target.target_type.as_str() {
            "git" => Ok(Self::Git(git::GitTargetAdapter)),
            "container" => Ok(Self::Container(container::ContainerTargetAdapter)),
            "sbom" => Ok(Self::Sbom(sbom::SbomTargetAdapter)),
            other => Err(ScannerError::TargetAccess(format!(
                "unsupported target type: {other}"
            ))),
        }
    }

    pub async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        match self {
            Self::Git(a) => a.prepare(target, work_dir).await,
            Self::Container(a) => a.prepare(target, work_dir).await,
            Self::Sbom(a) => a.prepare(target, work_dir).await,
        }
    }

    pub async fn materialize_sbom(
        &self,
        target: &Target,
        work_dir: &Path,
    ) -> Result<NormalizedSbom> {
        match self {
            Self::Git(a) => a.materialize_sbom(target, work_dir).await,
            Self::Container(a) => a.materialize_sbom(target, work_dir).await,
            Self::Sbom(a) => a.materialize_sbom(target, work_dir).await,
        }
    }

    pub async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String> {
        match self {
            Self::Git(a) => a.fingerprint(target, work_dir).await,
            Self::Container(a) => a.fingerprint(target, work_dir).await,
            Self::Sbom(a) => a.fingerprint(target, work_dir).await,
        }
    }
}
