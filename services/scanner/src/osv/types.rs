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
}

#[derive(Debug, Serialize)]
pub struct OsvQueryPackage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ecosystem: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purl: Option<String>,
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
    /// Extract the first CVSS base score, preferring v3 over v4.
    pub fn extract_cvss_score(&self) -> Option<f32> {
        // First try CVSS v3
        for sev in &self.severity {
            if sev.severity_type == "CVSS_V3" {
                if let Ok(score) = sev.score.parse::<f32>() {
                    return Some(score);
                }
                if sev.score.starts_with("CVSS:3")
                    && let Ok(base) = sev.score.parse::<cvss::v3::Base>()
                {
                    return Some(base.score().value() as f32);
                }
            }
        }
        // Fall back to CVSS v4 — approximate base score from vector metrics
        for sev in &self.severity {
            if sev.severity_type == "CVSS_V4" {
                if let Ok(score) = sev.score.parse::<f32>() {
                    return Some(score);
                }
                if sev.score.starts_with("CVSS:4") {
                    return Self::compute_cvss4_score(&sev.score);
                }
            }
        }
        None
    }

    /// Compute CVSS v4 base score from the vector string using the official
    /// FIRST.org lookup-table algorithm (via the `cvss` crate).
    fn compute_cvss4_score(vector: &str) -> Option<f32> {
        let v4: cvss::v4::Vector = vector.parse().ok()?;
        let score = cvss::v4::Score::from(&v4);
        Some(score.value() as f32)
    }

    /// Extract the CVSS vector string.
    pub fn extract_cvss_vector(&self) -> Option<&str> {
        self.severity
            .iter()
            .find(|s| {
                (s.severity_type == "CVSS_V3" || s.severity_type == "CVSS_V4")
                    && s.score.starts_with("CVSS:")
            })
            .map(|s| s.score.as_str())
    }

    /// Extract all fixed versions from affected ranges (deduplicated).
    pub fn extract_fix_versions(&self) -> Vec<String> {
        let mut versions: Vec<String> = self
            .affected
            .iter()
            .flat_map(|a| &a.ranges)
            .flat_map(|r| &r.events)
            .filter_map(|e| e.fixed.clone())
            .collect();
        versions.sort();
        versions.dedup();
        versions
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_vuln(severity_type: &str, score: &str) -> OsvVulnerability {
        OsvVulnerability {
            id: "TEST-001".to_string(),
            aliases: vec![],
            summary: None,
            severity: vec![OsvSeverity {
                severity_type: severity_type.to_string(),
                score: score.to_string(),
            }],
            affected: vec![],
        }
    }

    #[test]
    fn extract_cvss_score_from_numeric_string() {
        let vuln = make_vuln("CVSS_V3", "7.5");
        assert_eq!(vuln.extract_cvss_score(), Some(7.5));
    }

    #[test]
    fn extract_cvss_score_from_v31_vector() {
        let vuln = make_vuln("CVSS_V3", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
        let score = vuln.extract_cvss_score().expect("should parse vector");
        assert!((score - 9.8).abs() < 0.1, "expected ~9.8, got {score}");
    }

    #[test]
    fn extract_cvss_score_from_v30_vector() {
        let vuln = make_vuln("CVSS_V3", "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
        let score = vuln.extract_cvss_score().expect("should parse vector");
        assert!((score - 9.8).abs() < 0.1, "expected ~9.8, got {score}");
    }

    #[test]
    fn extract_cvss_score_none_for_invalid() {
        let vuln = make_vuln("CVSS_V3", "not-a-score");
        assert_eq!(vuln.extract_cvss_score(), None);
    }

    #[test]
    fn extract_cvss_score_none_for_empty_severity() {
        let vuln = OsvVulnerability {
            id: "TEST-002".to_string(),
            aliases: vec![],
            summary: None,
            severity: vec![],
            affected: vec![],
        };
        assert_eq!(vuln.extract_cvss_score(), None);
    }

    #[test]
    fn extract_cvss_score_from_v4_vector_high_impact() {
        // VC:H/VI:H/VA:H, network, no privileges → ~9.3
        let vuln = make_vuln(
            "CVSS_V4",
            "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
        );
        let score = vuln.extract_cvss_score().expect("should parse v4 vector");
        assert!((score - 9.3).abs() < 0.2, "expected ~9.3, got {score}");
    }

    #[test]
    fn extract_cvss_score_from_v4_cve_2026_27606() {
        // CVE-2026-27606 (Rollup path traversal): VC:H/VI:H/VA:N → ~8.7
        let vuln = make_vuln(
            "CVSS_V4",
            "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N/E:P",
        );
        let score = vuln.extract_cvss_score().expect("should parse v4 vector");
        assert!((score - 8.7).abs() < 0.5, "expected ~8.7, got {score}");
    }

    #[test]
    fn extract_cvss_score_from_v4_vector_low_impact() {
        // Low impact: AT:P, PR:L, VA:L only → ~2.0
        let vuln = make_vuln(
            "CVSS_V4",
            "CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N",
        );
        let score = vuln.extract_cvss_score().expect("should parse v4 vector");
        assert!(score < 4.0, "low-impact v4 should be <4, got {score}");
    }

    #[test]
    fn extract_cvss_score_from_v4_no_impact() {
        let vuln = make_vuln(
            "CVSS_V4",
            "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N",
        );
        let score = vuln.extract_cvss_score().expect("should parse v4 vector");
        assert!(
            (score - 0.0).abs() < 0.01,
            "no-impact v4 should be 0, got {score}"
        );
    }

    #[test]
    fn extract_cvss_v3_preferred_over_v4() {
        let vuln = OsvVulnerability {
            id: "TEST-003".to_string(),
            aliases: vec![],
            summary: None,
            severity: vec![
                OsvSeverity {
                    severity_type: "CVSS_V4".to_string(),
                    score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"
                        .to_string(),
                },
                OsvSeverity {
                    severity_type: "CVSS_V3".to_string(),
                    score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H".to_string(),
                },
            ],
            affected: vec![],
        };
        let score = vuln.extract_cvss_score().expect("should prefer v3");
        assert!(
            (score - 9.8).abs() < 0.1,
            "should use v3 score ~9.8, got {score}"
        );
    }

    #[test]
    fn extract_fix_versions_deduplicates() {
        let vuln = OsvVulnerability {
            id: "TEST-004".to_string(),
            aliases: vec![],
            summary: None,
            severity: vec![],
            affected: vec![
                OsvAffected {
                    package: None,
                    ranges: vec![OsvRange {
                        range_type: "ECOSYSTEM".to_string(),
                        events: vec![
                            OsvEvent {
                                introduced: Some("0".to_string()),
                                fixed: Some("7.9.4".to_string()),
                            },
                            OsvEvent {
                                introduced: None,
                                fixed: Some("2.17.2".to_string()),
                            },
                        ],
                    }],
                },
                OsvAffected {
                    package: None,
                    ranges: vec![OsvRange {
                        range_type: "ECOSYSTEM".to_string(),
                        events: vec![
                            OsvEvent {
                                introduced: Some("0".to_string()),
                                fixed: Some("7.9.4".to_string()),
                            },
                            OsvEvent {
                                introduced: None,
                                fixed: Some("2.17.2".to_string()),
                            },
                        ],
                    }],
                },
            ],
        };
        let versions = vuln.extract_fix_versions();
        assert_eq!(versions, vec!["2.17.2", "7.9.4"]);
    }
}
