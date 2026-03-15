use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::error::{Result, ScannerError};
use super::types::{NvdCve, NvdCveResponse};

const NVD_API_URL: &str = "https://services.nvd.nist.gov/rest/json/cves/2.0";
pub struct NvdClient {
    http: reqwest::Client,
    api_key: Option<String>,
    /// Semaphore-based rate limiter: permits = requests allowed per window.
    rate_semaphore: Arc<Semaphore>,
    rate_window: Duration,
}

impl NvdClient {
    pub fn new(api_key: Option<String>) -> Self {
        let (permits, window) = if api_key.is_some() {
            (50, Duration::from_secs(30))
        } else {
            (5, Duration::from_secs(30))
        };

        Self {
            http: reqwest::Client::builder()
                .user_agent("decree-scanner/0.1")
                .timeout(Duration::from_secs(30))
                .build()
                .expect("failed to build HTTP client"),
            api_key,
            rate_semaphore: Arc::new(Semaphore::new(permits)),
            rate_window: window,
        }
    }

    #[cfg(test)]
    fn with_client(http: reqwest::Client, api_key: Option<String>) -> Self {
        Self {
            http,
            api_key,
            rate_semaphore: Arc::new(Semaphore::new(100)),
            rate_window: Duration::from_millis(1),
        }
    }

    /// Fetch a single CVE from the NVD API.
    pub async fn fetch_cve(&self, cve_id: &str) -> Result<Option<NvdCve>> {
        self.fetch_cve_from(NVD_API_URL, cve_id).await
    }

    async fn fetch_cve_from(&self, base_url: &str, cve_id: &str) -> Result<Option<NvdCve>> {
        // Acquire rate-limit permit (released after the window)
        let permit = self
            .rate_semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| ScannerError::NvdApi(format!("rate limiter closed: {e}")))?;

        let window = self.rate_window;
        tokio::spawn(async move {
            tokio::time::sleep(window).await;
            drop(permit);
        });

        let url = format!("{base_url}?cveId={cve_id}");

        let mut request = self.http.get(&url);
        if let Some(key) = &self.api_key {
            request = request.header("apiKey", key);
        }

        let response = request
            .send()
            .await
            .map_err(|e| ScannerError::NvdApi(e.to_string()))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            warn!(status = %status, cve_id, "NVD API rate limited or forbidden");
            return Err(ScannerError::NvdApi(format!("NVD API returned {status}")));
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ScannerError::NvdApi(format!(
                "NVD API returned {status}: {body}"
            )));
        }

        let nvd_response: NvdCveResponse = response
            .json()
            .await
            .map_err(|e| ScannerError::NvdApi(e.to_string()))?;

        Ok(nvd_response.vulnerabilities.into_iter().next().map(|w| w.cve))
    }

    /// Sync NVD data for all CVE-* advisory IDs in vulnerability_instances.
    /// Skips CVEs that have a fresh snapshot (< CACHE_TTL_DAYS old).
    /// Returns count of newly inserted snapshots.
    pub async fn sync_known_cves(&self, pool: &PgPool) -> Result<u32> {
        self.sync_known_cves_from(NVD_API_URL, pool).await
    }

    async fn sync_known_cves_from(&self, base_url: &str, pool: &PgPool) -> Result<u32> {
        // Get CVE IDs that need NVD refresh
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT DISTINCT vi.advisory_id
            FROM vulnerability_instances vi
            WHERE vi.advisory_id LIKE 'CVE-%'
              AND NOT EXISTS (
                SELECT 1 FROM advisory_cvss_snapshots acs
                WHERE acs.cve_id = vi.advisory_id
                  AND acs.fetched_at > now() - interval '7 days'
              )
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ScannerError::Database)?;

        let cve_ids: Vec<String> = rows.into_iter().map(|r| r.0).collect();

        if cve_ids.is_empty() {
            info!("all CVEs have fresh NVD snapshots");
            return Ok(0);
        }

        info!(count = cve_ids.len(), "syncing NVD data for CVEs");

        let mut inserted = 0u32;
        let mut errors = 0u32;

        for cve_id in &cve_ids {
            match self.fetch_cve_from(base_url, cve_id).await {
                Ok(Some(cve)) => {
                    // Upsert advisory
                    let raw_json = serde_json::to_value(&cve).unwrap_or_default();
                    sqlx::query(
                        r#"
                        INSERT INTO advisories (advisory_id, source, raw_json, fetched_at)
                        VALUES ($1, 'nvd', $2, now())
                        ON CONFLICT (advisory_id, source) DO UPDATE SET
                            raw_json = EXCLUDED.raw_json,
                            fetched_at = now()
                        "#,
                    )
                    .bind(cve_id)
                    .bind(&raw_json)
                    .execute(pool)
                    .await
                    .map_err(ScannerError::Database)?;

                    // Insert CVSS snapshot
                    if let Some((base_score, vector)) = cve.best_cvss_v3() {
                        let result = sqlx::query(
                            r#"
                            INSERT INTO advisory_cvss_snapshots (cve_id, cvss_version, cvss_score, cvss_vector, source, fetched_at)
                            VALUES ($1, '3.1', $2, $3, 'nvd', now())
                            ON CONFLICT (cve_id, source) DO UPDATE SET
                                cvss_score = EXCLUDED.cvss_score,
                                cvss_vector = EXCLUDED.cvss_vector,
                                fetched_at = now()
                            "#,
                        )
                        .bind(cve_id)
                        .bind(base_score)
                        .bind(&vector)
                        .execute(pool)
                        .await
                        .map_err(ScannerError::Database)?;

                        if result.rows_affected() > 0 {
                            inserted += 1;
                        }
                    }

                    // Insert aliases
                    // NVD doesn't directly provide aliases, but we record the cve_id itself
                }
                Ok(None) => {
                    warn!(cve_id, "CVE not found in NVD");
                }
                Err(e) => {
                    warn!(cve_id, error = %e, "failed to fetch CVE from NVD, skipping");
                    errors += 1;
                }
            }
        }

        info!(inserted, errors, "NVD sync complete");
        Ok(inserted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sample_nvd_response() -> serde_json::Value {
        serde_json::json!({
            "resultsPerPage": 1,
            "totalResults": 1,
            "vulnerabilities": [{
                "cve": {
                    "id": "CVE-2024-1234",
                    "sourceIdentifier": "cve@mitre.org",
                    "published": "2024-01-15T10:00:00.000",
                    "lastModified": "2024-02-01T12:00:00.000",
                    "descriptions": [{
                        "lang": "en",
                        "value": "Test vulnerability description"
                    }],
                    "metrics": {
                        "cvssMetricV31": [{
                            "source": "nvd@nist.gov",
                            "type": "Primary",
                            "cvssData": {
                                "version": "3.1",
                                "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                                "baseScore": 9.8,
                                "baseSeverity": "CRITICAL"
                            }
                        }]
                    }
                }
            }]
        })
    }

    #[tokio::test]
    async fn parse_nvd_response() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/rest/json/cves/2.0"))
            .respond_with(ResponseTemplate::new(200).set_body_json(sample_nvd_response()))
            .mount(&server)
            .await;

        let client = NvdClient::new(None);
        let url = format!("{}/rest/json/cves/2.0", server.uri());
        let cve = client.fetch_cve_from(&url, "CVE-2024-1234").await.unwrap();

        let cve = cve.expect("should have a CVE");
        assert_eq!(cve.id, "CVE-2024-1234");

        let (score, vector) = cve.best_cvss_v3().expect("should have CVSS v3.1");
        assert!((score - 9.8).abs() < 0.01);
        assert!(vector.contains("CVSS:3.1"));

        assert_eq!(cve.en_description(), Some("Test vulnerability description"));
    }

    #[tokio::test]
    async fn handles_not_found() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/rest/json/cves/2.0"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let client = NvdClient::new(None);
        let url = format!("{}/rest/json/cves/2.0", server.uri());
        let result = client.fetch_cve_from(&url, "CVE-9999-0000").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn handles_rate_limit() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/rest/json/cves/2.0"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let client = NvdClient::new(None);
        let url = format!("{}/rest/json/cves/2.0", server.uri());
        let result = client.fetch_cve_from(&url, "CVE-2024-1234").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("429"));
    }

    #[test]
    fn cvss_v3_extraction() {
        let cve = NvdCve {
            id: "CVE-2024-0001".to_string(),
            source_identifier: None,
            published: None,
            last_modified: None,
            descriptions: None,
            metrics: Some(NvdMetrics {
                cvss_metric_v31: Some(vec![NvdCvssMetric {
                    source: Some("nvd@nist.gov".to_string()),
                    metric_type: Some("Primary".to_string()),
                    cvss_data: CvssData {
                        version: "3.1".to_string(),
                        vector_string: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H".to_string(),
                        base_score: 9.8,
                        base_severity: Some("CRITICAL".to_string()),
                    },
                }]),
                cvss_metric_v30: None,
                cvss_metric_v2: None,
            }),
        };

        let (score, vector) = cve.best_cvss_v3().unwrap();
        assert!((score - 9.8).abs() < 0.01);
        assert!(vector.starts_with("CVSS:3.1"));
    }

    #[test]
    fn cvss_v3_missing_returns_none() {
        let cve = NvdCve {
            id: "CVE-2024-0002".to_string(),
            source_identifier: None,
            published: None,
            last_modified: None,
            descriptions: None,
            metrics: None,
        };
        assert!(cve.best_cvss_v3().is_none());
    }
}
