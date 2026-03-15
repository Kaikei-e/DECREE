use tracing::{info, warn};

use crate::error::{Result, ScannerError};
use crate::osv::types::{
    OsvBatchRequest, OsvBatchResponse, OsvBatchResult, OsvQuery, OsvQueryPackage,
};
use crate::sbom::model::NormalizedPackage;

const OSV_BATCH_URL: &str = "https://api.osv.dev/v1/querybatch";
const BATCH_CHUNK_SIZE: usize = 1000;

pub struct OsvClient {
    http: reqwest::Client,
}

impl Default for OsvClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OsvClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent("decree-scanner/0.1")
                .build()
                .expect("failed to build HTTP client"),
        }
    }

    /// Query OSV for vulnerabilities affecting the given packages.
    /// Returns one `OsvBatchResult` per input package (in the same order).
    pub async fn query_batch(
        &self,
        packages: &[NormalizedPackage],
    ) -> Result<Vec<OsvBatchResult>> {
        if packages.is_empty() {
            return Ok(Vec::new());
        }

        let mut all_results = Vec::with_capacity(packages.len());

        for chunk in packages.chunks(BATCH_CHUNK_SIZE) {
            let queries: Vec<OsvQuery> = chunk
                .iter()
                .map(|pkg| {
                    if let Some(purl) = &pkg.purl {
                        OsvQuery {
                            purl: Some(purl.clone()),
                            package: None,
                            version: None,
                        }
                    } else {
                        let ecosystem_str = pkg.ecosystem.as_osv_str().to_string();
                        OsvQuery {
                            purl: None,
                            package: Some(OsvQueryPackage {
                                name: pkg.name.clone(),
                                ecosystem: ecosystem_str,
                            }),
                            version: Some(pkg.version.clone()),
                        }
                    }
                })
                .collect();

            let request = OsvBatchRequest { queries };

            info!(
                chunk_size = chunk.len(),
                "querying OSV batch API"
            );

            let response = self
                .http
                .post(OSV_BATCH_URL)
                .json(&request)
                .send()
                .await
                .map_err(|e| ScannerError::OsvApi(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "<unreadable>".to_string());
                return Err(ScannerError::OsvApi(format!(
                    "OSV API returned {status}: {body}"
                )));
            }

            let batch: OsvBatchResponse = response
                .json()
                .await
                .map_err(|e| ScannerError::OsvApi(e.to_string()))?;

            if batch.results.len() != chunk.len() {
                warn!(
                    expected = chunk.len(),
                    got = batch.results.len(),
                    "OSV batch response size mismatch"
                );
            }

            all_results.extend(batch.results);
        }

        Ok(all_results)
    }
}

/// Determine the advisory source string for an OSV vulnerability ID.
pub fn advisory_source(vuln_id: &str) -> &str {
    if vuln_id.starts_with("CVE-") {
        "nvd"
    } else if vuln_id.starts_with("GHSA-") {
        "ghsa"
    } else {
        "osv"
    }
}

/// Map a CVSS score to a severity string.
#[deprecated(note = "use enrichment::score::severity_label instead")]
pub fn severity_from_cvss(score: Option<f32>) -> &'static str {
    crate::enrichment::score::severity_label(score)
}

/// Compute the M1 provisional DECREE score (EPSS and reachability deferred to M2).
#[deprecated(note = "use enrichment::score::decree_score instead")]
pub fn provisional_decree_score(cvss: Option<f32>) -> Option<f32> {
    // Preserved M1 behavior: cvss * 0.4 only
    cvss.map(|c| c * 0.4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn severity_mapping() {
        assert_eq!(severity_from_cvss(Some(9.8)), "critical");
        assert_eq!(severity_from_cvss(Some(7.5)), "high");
        assert_eq!(severity_from_cvss(Some(5.0)), "medium");
        assert_eq!(severity_from_cvss(Some(2.0)), "low");
        assert_eq!(severity_from_cvss(None), "unknown");
    }

    #[test]
    fn provisional_score() {
        let score = provisional_decree_score(Some(9.0));
        assert!((score.unwrap() - 3.6).abs() < 0.01);
    }

    #[test]
    fn advisory_source_detection() {
        assert_eq!(advisory_source("CVE-2024-1234"), "nvd");
        assert_eq!(advisory_source("GHSA-xxxx-yyyy-zzzz"), "ghsa");
        assert_eq!(advisory_source("GO-2024-0001"), "osv");
    }
}
