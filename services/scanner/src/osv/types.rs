use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct OsvBatchRequest {
    pub queries: Vec<OsvQuery>,
}

#[derive(Debug, Serialize)]
pub struct OsvQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<OsvQueryPackage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purl: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OsvQueryPackage {
    pub name: String,
    pub ecosystem: String,
}

#[derive(Debug, Deserialize)]
pub struct OsvBatchResponse {
    pub results: Vec<OsvBatchResult>,
}

#[derive(Debug, Deserialize)]
pub struct OsvBatchResult {
    #[serde(default)]
    pub vulns: Vec<OsvVulnerability>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvVulnerability {
    pub id: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub severity: Vec<OsvSeverity>,
    #[serde(default)]
    pub affected: Vec<OsvAffected>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvSeverity {
    #[serde(rename = "type")]
    pub severity_type: String,
    pub score: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvAffected {
    pub package: Option<OsvAffectedPackage>,
    #[serde(default)]
    pub ranges: Vec<OsvRange>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvAffectedPackage {
    pub ecosystem: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvRange {
    #[serde(rename = "type")]
    pub range_type: String,
    #[serde(default)]
    pub events: Vec<OsvEvent>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvEvent {
    pub introduced: Option<String>,
    pub fixed: Option<String>,
}

impl OsvVulnerability {
    /// Extract the first CVSS v3 base score, if available.
    pub fn extract_cvss_score(&self) -> Option<f32> {
        for sev in &self.severity {
            if sev.severity_type == "CVSS_V3" {
                // Parse score from CVSS vector or direct numeric
                if let Ok(score) = sev.score.parse::<f32>() {
                    return Some(score);
                }
                // Try to extract from vector string like "CVSS:3.1/AV:N/..."
                // We'll approximate from the vector using known base score patterns
                // For now, return None if it's a vector string (proper CVSS parsing in M2)
            }
        }
        None
    }

    /// Extract the CVSS vector string.
    pub fn extract_cvss_vector(&self) -> Option<&str> {
        self.severity
            .iter()
            .find(|s| s.severity_type == "CVSS_V3" && s.score.starts_with("CVSS:"))
            .map(|s| s.score.as_str())
    }

    /// Extract all fixed versions from affected ranges.
    pub fn extract_fix_versions(&self) -> Vec<String> {
        self.affected
            .iter()
            .flat_map(|a| &a.ranges)
            .flat_map(|r| &r.events)
            .filter_map(|e| e.fixed.clone())
            .collect()
    }

    /// Return the primary advisory ID (prefer CVE alias over OSV/GHSA).
    pub fn primary_id(&self) -> &str {
        self.aliases
            .iter()
            .find(|a| a.starts_with("CVE-"))
            .map(|s| s.as_str())
            .unwrap_or(&self.id)
    }
}
