use std::time::Duration;

use sqlx::PgPool;
use tracing::info;

use crate::error::{Result, ScannerError};
use super::types::{EpssApiResponse, EpssEntry};

const EPSS_API_URL: &str = "https://api.first.org/data/v1/epss";
const CHUNK_SIZE: usize = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub struct EpssClient {
    http: reqwest::Client,
}

impl Default for EpssClient {
    fn default() -> Self {
        Self::new()
    }
}

impl EpssClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent("decree-scanner/0.1")
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("failed to build HTTP client"),
        }
    }

    #[cfg(test)]
    fn with_client(http: reqwest::Client) -> Self {
        Self { http }
    }

    /// Fetch EPSS data for a batch of CVE IDs.
    pub async fn fetch_batch(&self, cve_ids: &[String]) -> Result<Vec<EpssEntry>> {
        self.fetch_batch_from(EPSS_API_URL, cve_ids).await
    }

    async fn fetch_batch_from(&self, base_url: &str, cve_ids: &[String]) -> Result<Vec<EpssEntry>> {
        if cve_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut all_entries = Vec::new();

        for chunk in cve_ids.chunks(CHUNK_SIZE) {
            let cve_param = chunk.join(",");
            let url = format!("{base_url}?cve={cve_param}");

            info!(chunk_size = chunk.len(), "fetching EPSS data");

            let response = self
                .http
                .get(&url)
                .send()
                .await
                .map_err(|e| ScannerError::EpssApi(e.to_string()))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(ScannerError::EpssApi(format!(
                    "EPSS API returned {status}: {body}"
                )));
            }

            let api_response: EpssApiResponse = response
                .json()
                .await
                .map_err(|e| ScannerError::EpssApi(e.to_string()))?;

            all_entries.extend(api_response.data);
        }

        Ok(all_entries)
    }

    /// Sync EPSS data for all CVE-* advisory IDs in vulnerability_instances.
    /// Inserts into advisory_epss_snapshots. Returns the count of new rows inserted.
    pub async fn sync_known_cves(&self, pool: &PgPool) -> Result<u32> {
        self.sync_known_cves_from(EPSS_API_URL, pool).await
    }

    async fn sync_known_cves_from(&self, base_url: &str, pool: &PgPool) -> Result<u32> {
        // Gather all CVE-* IDs from vulnerability_instances
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT advisory_id FROM vulnerability_instances WHERE advisory_id LIKE 'CVE-%'"
        )
        .fetch_all(pool)
        .await
        .map_err(ScannerError::Database)?;

        let cve_ids: Vec<String> = rows.into_iter().map(|r| r.0).collect();

        if cve_ids.is_empty() {
            info!("no CVE IDs to sync EPSS data for");
            return Ok(0);
        }

        info!(count = cve_ids.len(), "syncing EPSS for known CVEs");

        let entries = self.fetch_batch_from(base_url, &cve_ids).await?;
        let mut inserted = 0u32;

        for entry in &entries {
            let result = sqlx::query(
                r#"
                INSERT INTO advisory_epss_snapshots (cve_id, epss_score, epss_percentile, epss_date, fetched_at)
                VALUES ($1, $2, $3, $4::date, now())
                ON CONFLICT (cve_id, epss_date) DO NOTHING
                "#,
            )
            .bind(&entry.cve)
            .bind(entry.epss)
            .bind(entry.percentile)
            .bind(&entry.date)
            .execute(pool)
            .await
            .map_err(ScannerError::Database)?;

            if result.rows_affected() > 0 {
                inserted += 1;
            }
        }

        info!(inserted, total_fetched = entries.len(), "EPSS sync complete");
        Ok(inserted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sample_epss_response() -> serde_json::Value {
        serde_json::json!({
            "status": "OK",
            "status-code": 200,
            "total": 2,
            "data": [
                {
                    "cve": "CVE-2024-1234",
                    "epss": "0.05432",
                    "percentile": "0.82100",
                    "date": "2026-03-14"
                },
                {
                    "cve": "CVE-2024-5678",
                    "epss": "0.91000",
                    "percentile": "0.99800",
                    "date": "2026-03-14"
                }
            ]
        })
    }

    #[tokio::test]
    async fn parse_epss_response() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/data/v1/epss"))
            .respond_with(ResponseTemplate::new(200).set_body_json(sample_epss_response()))
            .mount(&server)
            .await;

        let client = EpssClient::new();
        let cves = vec![
            "CVE-2024-1234".to_string(),
            "CVE-2024-5678".to_string(),
        ];

        let url = format!("{}/data/v1/epss", server.uri());
        let entries = client.fetch_batch_from(&url, &cves).await.unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].cve, "CVE-2024-1234");
        assert!((entries[0].epss - 0.05432).abs() < 0.0001);
        assert!((entries[0].percentile - 0.821).abs() < 0.001);
        assert_eq!(entries[1].cve, "CVE-2024-5678");
        assert!((entries[1].epss - 0.91).abs() < 0.001);
    }

    #[tokio::test]
    async fn chunking_large_batch() {
        let server = MockServer::start().await;

        // Return an empty valid response for any chunk
        Mock::given(method("GET"))
            .and(path("/data/v1/epss"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "OK",
                "status-code": 200,
                "total": 0,
                "data": []
            })))
            .expect(2) // 150 CVEs / 100 chunk = 2 requests
            .mount(&server)
            .await;

        let client = EpssClient::new();
        let cves: Vec<String> = (0..150).map(|i| format!("CVE-2024-{i:04}")).collect();

        let url = format!("{}/data/v1/epss", server.uri());
        let entries = client.fetch_batch_from(&url, &cves).await.unwrap();
        assert_eq!(entries.len(), 0);
    }

    #[tokio::test]
    async fn handles_api_error() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/data/v1/epss"))
            .respond_with(ResponseTemplate::new(500).set_body_string("internal error"))
            .mount(&server)
            .await;

        let client = EpssClient::new();
        let cves = vec!["CVE-2024-0001".to_string()];

        let url = format!("{}/data/v1/epss", server.uri());
        let result = client.fetch_batch_from(&url, &cves).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("500"));
    }

    #[tokio::test]
    async fn empty_input_returns_empty() {
        let client = EpssClient::new();
        let entries = client.fetch_batch(&[]).await.unwrap();
        assert!(entries.is_empty());
    }
}
