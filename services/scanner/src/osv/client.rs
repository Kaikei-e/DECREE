use tracing::{debug, info, warn};

use crate::error::{Result, ScannerError};
use crate::osv::types::{
    OsvBatchRequest, OsvBatchResponse, OsvBatchResult, OsvQuery, OsvQueryPackage, OsvVulnerability,
};
use crate::sbom::model::NormalizedPackage;

const OSV_BATCH_URL: &str = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL: &str = "https://api.osv.dev/v1/vulns";
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
            http: crate::http::default_client(),
        }
    }

    /// Query OSV for vulnerabilities affecting the given packages.
    /// Returns one `OsvBatchResult` per input package (in the same order).
    pub async fn query_batch(&self, packages: &[NormalizedPackage]) -> Result<Vec<OsvBatchResult>> {
        if packages.is_empty() {
            return Ok(Vec::new());
        }

        let mut all_results = Vec::with_capacity(packages.len());

        for chunk in packages.chunks(BATCH_CHUNK_SIZE) {
            // Build queries, tracking which chunk indices are queryable
            let mut queries = Vec::new();
            let mut queryable_indices = Vec::new();

            for (i, pkg) in chunk.iter().enumerate() {
                if let Some(purl) = &pkg.purl {
                    debug!(purl = %purl, "querying OSV via PURL");
                    queries.push(OsvQuery {
                        package: Some(OsvQueryPackage {
                            name: None,
                            ecosystem: None,
                            purl: Some(purl.clone()),
                        }),
                        version: None,
                    });
                    queryable_indices.push(i);
                } else {
                    let ecosystem_str = pkg.ecosystem.as_osv_str();
                    if ecosystem_str.is_empty() || pkg.name.is_empty() || pkg.version.is_empty() {
                        warn!(
                            name = %pkg.name,
                            ecosystem = %pkg.ecosystem,
                            "skipping package with missing ecosystem/name/version for OSV query"
                        );
                    } else {
                        debug!(
                            name = %pkg.name,
                            version = %pkg.version,
                            ecosystem = %ecosystem_str,
                            "querying OSV via ecosystem/name/version"
                        );
                        queries.push(OsvQuery {
                            package: Some(OsvQueryPackage {
                                name: Some(pkg.name.clone()),
                                ecosystem: Some(ecosystem_str.to_string()),
                                purl: None,
                            }),
                            version: Some(pkg.version.clone()),
                        });
                        queryable_indices.push(i);
                    }
                }
            }

            if queries.is_empty() {
                // All packages in this chunk were skipped — fill with empty results
                all_results.extend((0..chunk.len()).map(|_| OsvBatchResult { vulns: vec![] }));
                continue;
            }

            let query_count = queries.len();
            info!(
                chunk_size = chunk.len(),
                query_count,
                skipped = chunk.len() - query_count,
                "querying OSV batch API"
            );

            let request = OsvBatchRequest { queries };

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

            if batch.results.len() != query_count {
                warn!(
                    expected = query_count,
                    got = batch.results.len(),
                    "OSV batch response size mismatch"
                );
            }

            // Reconstruct 1:1 mapping: empty result for skipped packages
            let mut batch_iter = batch.results.into_iter();
            for i in 0..chunk.len() {
                if queryable_indices.contains(&i) {
                    all_results.push(
                        batch_iter
                            .next()
                            .unwrap_or(OsvBatchResult { vulns: vec![] }),
                    );
                } else {
                    all_results.push(OsvBatchResult { vulns: vec![] });
                }
            }
        }

        // Hydrate stub vulnerabilities with full details (severity, aliases, affected)
        self.hydrate_results(&mut all_results).await?;

        Ok(all_results)
    }

    /// Fetch full vulnerability details from OSV for a single ID.
    async fn fetch_vuln(&self, vuln_id: &str) -> Result<OsvVulnerability> {
        let url = format!("{OSV_VULN_URL}/{vuln_id}");
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| ScannerError::OsvApi(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            return Err(ScannerError::OsvApi(format!(
                "OSV vuln fetch {vuln_id} returned {status}"
            )));
        }

        response
            .json()
            .await
            .map_err(|e| ScannerError::OsvApi(e.to_string()))
    }

    /// Replace stub vulnerabilities (from batch API) with full details.
    /// The batch API only returns id+modified; we need severity, aliases, affected.
    async fn hydrate_results(&self, results: &mut [OsvBatchResult]) -> Result<()> {
        // Collect unique vuln IDs
        let mut seen = std::collections::HashSet::new();
        let mut ids_to_fetch = Vec::new();
        for result in results.iter() {
            for vuln in &result.vulns {
                if seen.insert(vuln.id.clone()) {
                    ids_to_fetch.push(vuln.id.clone());
                }
            }
        }

        if ids_to_fetch.is_empty() {
            return Ok(());
        }

        info!(
            count = ids_to_fetch.len(),
            "hydrating OSV vulnerabilities with full details"
        );

        let mut full_vulns = std::collections::HashMap::new();
        for id in &ids_to_fetch {
            match self.fetch_vuln(id).await {
                Ok(vuln) => {
                    full_vulns.insert(vuln.id.clone(), vuln);
                }
                Err(e) => {
                    warn!(vuln_id = %id, %e, "failed to fetch OSV vuln details, skipping");
                }
            }
        }

        // Replace stubs with full records
        for result in results.iter_mut() {
            for vuln in result.vulns.iter_mut() {
                if let Some(full) = full_vulns.get(&vuln.id) {
                    *vuln = full.clone();
                }
            }
        }

        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osv::types::{OsvBatchRequest, OsvQuery, OsvQueryPackage};

    #[test]
    fn osv_query_purl_serializes_inside_package() {
        let query = OsvQuery {
            package: Some(OsvQueryPackage {
                name: None,
                ecosystem: None,
                purl: Some("pkg:golang/github.com/foo/bar@1.0.0".to_string()),
            }),
            version: None,
        };
        let batch = OsvBatchRequest {
            queries: vec![query],
        };
        let json = serde_json::to_value(&batch).unwrap();
        let q = &json["queries"][0];
        // purl must be inside "package", not at top level
        assert!(q.get("purl").is_none(), "purl must not be at top level");
        assert_eq!(q["package"]["purl"], "pkg:golang/github.com/foo/bar@1.0.0");
        // name/ecosystem should be absent
        assert!(q["package"].get("name").is_none());
        assert!(q["package"].get("ecosystem").is_none());
    }

    #[test]
    fn osv_query_ecosystem_path_serializes_correctly() {
        let query = OsvQuery {
            package: Some(OsvQueryPackage {
                name: Some("express".to_string()),
                ecosystem: Some("npm".to_string()),
                purl: None,
            }),
            version: Some("4.18.0".to_string()),
        };
        let json = serde_json::to_value(&query).unwrap();
        assert_eq!(json["package"]["name"], "express");
        assert_eq!(json["package"]["ecosystem"], "npm");
        assert_eq!(json["version"], "4.18.0");
        assert!(json["package"].get("purl").is_none());
    }

    #[test]
    fn advisory_source_detection() {
        assert_eq!(advisory_source("CVE-2024-1234"), "nvd");
        assert_eq!(advisory_source("GHSA-xxxx-yyyy-zzzz"), "ghsa");
        assert_eq!(advisory_source("GO-2024-0001"), "osv");
    }
}
