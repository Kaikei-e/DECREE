use serde::Deserialize;

use crate::error::{Result, ScannerError};
use crate::sbom::model::{DependencyEdge, Ecosystem, NormalizedPackage, NormalizedSbom};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CycloneDxBom {
    #[allow(dead_code)]
    bom_format: Option<String>,
    components: Option<Vec<CycloneDxComponent>>,
    dependencies: Option<Vec<CycloneDxDependency>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CycloneDxComponent {
    name: String,
    version: Option<String>,
    purl: Option<String>,
    #[serde(rename = "bom-ref")]
    bom_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CycloneDxDependency {
    #[serde(rename = "ref")]
    dep_ref: String,
    #[serde(rename = "dependsOn", default)]
    depends_on: Vec<String>,
}

pub fn parse_cyclonedx(data: &[u8]) -> Result<NormalizedSbom> {
    let bom: CycloneDxBom =
        serde_json::from_slice(data).map_err(|e| ScannerError::SbomParse(e.to_string()))?;

    let components = bom.components.unwrap_or_default();

    // Build a set of direct dependency refs from the top-level dependency entry
    let deps = bom.dependencies.unwrap_or_default();
    let direct_refs: std::collections::HashSet<&str> = deps
        .first()
        .map(|root| root.depends_on.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();

    let packages = components
        .iter()
        .map(|c| {
            let ecosystem = c
                .purl
                .as_deref()
                .map(Ecosystem::from_purl)
                .unwrap_or(Ecosystem::Unknown);
            let bom_ref = c.bom_ref.as_deref().or(c.purl.as_deref()).unwrap_or("");
            let is_direct = direct_refs.contains(bom_ref);
            NormalizedPackage {
                name: c.name.clone(),
                version: c.version.clone().unwrap_or_default(),
                ecosystem,
                purl: c.purl.clone(),
                is_direct,
                dep_depth: if is_direct { 1 } else { 2 },
            }
        })
        .collect();

    let edges = deps
        .iter()
        .flat_map(|d| {
            d.depends_on.iter().map(move |dep| DependencyEdge {
                from_pkg: d.dep_ref.clone(),
                to_pkg: dep.clone(),
                dep_type: "depends_on".to_string(),
            })
        })
        .collect();

    Ok(NormalizedSbom { packages, edges })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_cyclonedx() {
        let json = include_bytes!("../../tests/fixtures/cyclonedx_minimal.json");
        let sbom = parse_cyclonedx(json).unwrap();
        assert!(!sbom.packages.is_empty());
        // Verify ecosystem detection from purl
        let pkg = &sbom.packages[0];
        assert_ne!(pkg.ecosystem, Ecosystem::Unknown);
    }
}
