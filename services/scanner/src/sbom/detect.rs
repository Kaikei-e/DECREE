use crate::error::{Result, ScannerError};
use crate::sbom::model::NormalizedSbom;

/// Auto-detect SBOM format and parse.
pub fn parse_sbom(data: &[u8]) -> Result<NormalizedSbom> {
    // Quick JSON probe to detect format
    let value: serde_json::Value =
        serde_json::from_slice(data).map_err(|e| ScannerError::SbomParse(e.to_string()))?;

    if value.get("bomFormat").is_some() || value.get("$schema").and_then(|s| s.as_str()).is_some_and(|s| s.contains("cyclonedx")) {
        return super::cyclonedx::parse_cyclonedx(data);
    }

    if value.get("spdxVersion").is_some() {
        return super::spdx::parse_spdx(data);
    }

    if value.get("artifacts").is_some() || value.get("source").is_some() {
        return super::syft::parse_syft(data);
    }

    Err(ScannerError::SbomParse(
        "unrecognized SBOM format: expected CycloneDX, SPDX, or Syft JSON".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_cyclonedx() {
        let data = include_bytes!("../../tests/fixtures/cyclonedx_minimal.json");
        let sbom = parse_sbom(data).unwrap();
        assert!(!sbom.packages.is_empty());
    }

    #[test]
    fn detect_spdx() {
        let data = include_bytes!("../../tests/fixtures/spdx_minimal.json");
        let sbom = parse_sbom(data).unwrap();
        assert!(!sbom.packages.is_empty());
    }

    #[test]
    fn detect_syft() {
        let data = include_bytes!("../../tests/fixtures/syft_minimal.json");
        let sbom = parse_sbom(data).unwrap();
        assert!(!sbom.packages.is_empty());
    }
}
