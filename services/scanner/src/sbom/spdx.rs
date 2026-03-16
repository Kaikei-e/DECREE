use serde::Deserialize;

use crate::error::{Result, ScannerError};
use crate::sbom::model::{DependencyEdge, Ecosystem, NormalizedPackage, NormalizedSbom};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpdxDocument {
    #[allow(dead_code)]
    spdx_version: Option<String>,
    #[serde(default)]
    packages: Vec<SpdxPackage>,
    #[serde(default)]
    relationships: Vec<SpdxRelationship>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpdxPackage {
    #[serde(rename = "SPDXID")]
    spdx_id: String,
    name: String,
    version_info: Option<String>,
    #[serde(default)]
    external_refs: Vec<SpdxExternalRef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpdxExternalRef {
    reference_type: String,
    reference_locator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpdxRelationship {
    spdx_element_id: String,
    related_spdx_element: String,
    relationship_type: String,
}

pub fn parse_spdx(data: &[u8]) -> Result<NormalizedSbom> {
    let doc: SpdxDocument =
        serde_json::from_slice(data).map_err(|e| ScannerError::SbomParse(e.to_string()))?;

    // Determine direct deps via DEPENDS_ON from the document root (SPDXRef-DOCUMENT)
    let direct_ids: std::collections::HashSet<&str> = doc
        .relationships
        .iter()
        .filter(|r| r.relationship_type == "DEPENDS_ON" && r.spdx_element_id == "SPDXRef-DOCUMENT")
        .map(|r| r.related_spdx_element.as_str())
        .collect();

    let packages = doc
        .packages
        .iter()
        .filter(|p| p.spdx_id != "SPDXRef-DOCUMENT")
        .map(|p| {
            let purl = p
                .external_refs
                .iter()
                .find(|r| r.reference_type == "purl")
                .map(|r| r.reference_locator.clone());
            let ecosystem = purl
                .as_deref()
                .map(Ecosystem::from_purl)
                .unwrap_or(Ecosystem::Unknown);
            let is_direct = direct_ids.contains(p.spdx_id.as_str());
            NormalizedPackage {
                name: p.name.clone(),
                version: p.version_info.clone().unwrap_or_default(),
                ecosystem,
                purl,
                is_direct,
                dep_depth: if is_direct { 1 } else { 2 },
            }
        })
        .collect();

    let edges = doc
        .relationships
        .iter()
        .filter(|r| r.relationship_type == "DEPENDS_ON")
        .map(|r| DependencyEdge {
            from_pkg: r.spdx_element_id.clone(),
            to_pkg: r.related_spdx_element.clone(),
            dep_type: "depends_on".to_string(),
        })
        .collect();

    Ok(NormalizedSbom { packages, edges })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_spdx() {
        let json = include_bytes!("../../tests/fixtures/spdx_minimal.json");
        let sbom = parse_spdx(json).unwrap();
        assert!(!sbom.packages.is_empty());
    }
}
