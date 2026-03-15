use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedSbom {
    pub packages: Vec<NormalizedPackage>,
    pub edges: Vec<DependencyEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedPackage {
    pub name: String,
    pub version: String,
    pub ecosystem: Ecosystem,
    pub purl: Option<String>,
    pub is_direct: bool,
    pub dep_depth: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ecosystem {
    Go,
    Npm,
    Crate,
    PyPI,
    NuGet,
    Maven,
    Unknown,
}

impl Ecosystem {
    /// Infer ecosystem from a purl string.
    pub fn from_purl(purl: &str) -> Self {
        // purl format: pkg:<type>/<namespace>/<name>@<version>
        let Some(rest) = purl.strip_prefix("pkg:") else {
            return Self::Unknown;
        };
        let typ = rest.split('/').next().unwrap_or("");
        match typ {
            "golang" => Self::Go,
            "npm" => Self::Npm,
            "cargo" => Self::Crate,
            "pypi" => Self::PyPI,
            "nuget" => Self::NuGet,
            "maven" => Self::Maven,
            _ => Self::Unknown,
        }
    }

    pub fn as_osv_str(&self) -> &'static str {
        match self {
            Self::Go => "Go",
            Self::Npm => "npm",
            Self::Crate => "crates.io",
            Self::PyPI => "PyPI",
            Self::NuGet => "NuGet",
            Self::Maven => "Maven",
            Self::Unknown => "",
        }
    }
}

impl std::fmt::Display for Ecosystem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_osv_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyEdge {
    pub from_pkg: String,
    pub to_pkg: String,
    pub dep_type: String,
}
