pub mod container;
pub mod git;
pub mod sbom;

use std::path::Path;

use crate::db::models::Target;
use crate::error::{Result, ScannerError};
use crate::sbom::model::NormalizedSbom;

/// Contract that every target adapter must satisfy.
/// Uses native async fn in trait (Rust 2024 — no async-trait crate needed).
/// This trait is only used for enum dispatch within this crate, so we suppress
/// the public async-fn-in-trait lint (Send bounds are not needed here).
#[allow(async_fn_in_trait)]
pub trait Adapter {
    async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()>;
    async fn materialize_sbom(&self, target: &Target, work_dir: &Path) -> Result<NormalizedSbom>;
    async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String>;
}

impl Adapter for git::GitTargetAdapter {
    async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        self.prepare(target, work_dir).await
    }
    async fn materialize_sbom(&self, target: &Target, work_dir: &Path) -> Result<NormalizedSbom> {
        self.materialize_sbom(target, work_dir).await
    }
    async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String> {
        self.fingerprint(target, work_dir).await
    }
}

impl Adapter for container::ContainerTargetAdapter {
    async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        self.prepare(target, work_dir).await
    }
    async fn materialize_sbom(&self, target: &Target, work_dir: &Path) -> Result<NormalizedSbom> {
        self.materialize_sbom(target, work_dir).await
    }
    async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String> {
        self.fingerprint(target, work_dir).await
    }
}

impl Adapter for sbom::SbomTargetAdapter {
    async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        self.prepare(target, work_dir).await
    }
    async fn materialize_sbom(&self, target: &Target, work_dir: &Path) -> Result<NormalizedSbom> {
        self.materialize_sbom(target, work_dir).await
    }
    async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String> {
        self.fingerprint(target, work_dir).await
    }
}

/// Enum dispatch adapter — the set of target types is fixed.
pub enum TargetAdapter {
    Git(git::GitTargetAdapter),
    Container(container::ContainerTargetAdapter),
    Sbom(sbom::SbomTargetAdapter),
}

macro_rules! delegate_adapter {
    ($self:expr, $method:ident, $($arg:expr),*) => {
        match $self {
            Self::Git(a) => a.$method($($arg),*).await,
            Self::Container(a) => a.$method($($arg),*).await,
            Self::Sbom(a) => a.$method($($arg),*).await,
        }
    };
}

impl TargetAdapter {
    pub fn from_target(target: &Target) -> Result<Self> {
        match target.target_type.as_str() {
            "git" | "repository" => Ok(Self::Git(git::GitTargetAdapter)),
            "container" => Ok(Self::Container(container::ContainerTargetAdapter)),
            "sbom" => Ok(Self::Sbom(sbom::SbomTargetAdapter)),
            other => Err(ScannerError::TargetAccess(format!(
                "unsupported target type: {other}"
            ))),
        }
    }

    pub async fn prepare(&self, target: &Target, work_dir: &Path) -> Result<()> {
        delegate_adapter!(self, prepare, target, work_dir)
    }

    pub async fn materialize_sbom(
        &self,
        target: &Target,
        work_dir: &Path,
    ) -> Result<NormalizedSbom> {
        delegate_adapter!(self, materialize_sbom, target, work_dir)
    }

    pub async fn fingerprint(&self, target: &Target, work_dir: &Path) -> Result<String> {
        delegate_adapter!(self, fingerprint, target, work_dir)
    }
}
