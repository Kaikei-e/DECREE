use serde::Deserialize;

use crate::error::{Result, ScannerError};
use crate::sbom::model::{DependencyEdge, Ecosystem, NormalizedPackage, NormalizedSbom};

#[derive(Debug, Deserialize)]
struct SyftDocument {
    #[serde(default)]
    artifacts: Vec<SyftArtifact>,
    #[serde(default, rename = "artifactRelationships")]
    artifact_relationships: Vec<SyftRelationship>,
}

#[derive(Debug, Deserialize)]
struct SyftArtifact {
    name: String,
    version: String,
    #[serde(default)]
    purl: String,
    #[serde(default)]
    language: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    pkg_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SyftRelationship {
    parent: String,
    child: String,
    #[serde(rename = "type")]
    rel_type: String,
}

pub fn parse_syft(data: &[u8]) -> Result<NormalizedSbom> {
    let doc: SyftDocument =
        serde_json::from_slice(data).map_err(|e| ScannerError::SbomParse(e.to_string()))?;

    let packages = doc
        .artifacts
        .iter()
        .map(|a| {
            let ecosystem = if !a.purl.is_empty() {
                Ecosystem::from_purl(&a.purl)
            } else {
                ecosystem_from_language(&a.language)
            };
            NormalizedPackage {
                name: a.name.clone(),
                version: a.version.clone(),
                ecosystem,
                purl: if a.purl.is_empty() {
                    None
                } else {
                    Some(a.purl.clone())
                },
                is_direct: true, // Syft doesn't distinguish; default to direct
                dep_depth: 1,
            }
        })
        .collect();

    let edges = doc
        .artifact_relationships
        .iter()
        .map(|r| DependencyEdge {
            from_pkg: r.parent.clone(),
            to_pkg: r.child.clone(),
            dep_type: r.rel_type.clone(),
        })
        .collect();

    Ok(NormalizedSbom { packages, edges })
}

fn ecosystem_from_language(lang: &str) -> Ecosystem {
    match lang.to_lowercase().as_str() {
        "go" | "golang" => Ecosystem::Go,
        "javascript" | "typescript" | "node" => Ecosystem::Npm,
        "rust" => Ecosystem::Crate,
        "python" => Ecosystem::PyPI,
        "dotnet" | "csharp" => Ecosystem::NuGet,
        "java" | "kotlin" | "scala" => Ecosystem::Maven,
        _ => Ecosystem::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_syft() {
        let json = include_bytes!("../../tests/fixtures/syft_minimal.json");
        let sbom = parse_syft(json).unwrap();
        assert!(!sbom.packages.is_empty());
    }
}
