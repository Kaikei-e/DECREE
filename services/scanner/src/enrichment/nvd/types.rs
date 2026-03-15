use serde::{Deserialize, Serialize};

/// Top-level NVD API 2.0 response for a single CVE.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvdCveResponse {
    pub results_per_page: u32,
    pub total_results: u32,
    pub vulnerabilities: Vec<NvdVulnWrapper>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NvdVulnWrapper {
    pub cve: NvdCve,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvdCve {
    pub id: String,
    pub source_identifier: Option<String>,
    pub published: Option<String>,
    pub last_modified: Option<String>,
    pub descriptions: Option<Vec<NvdDescription>>,
    pub metrics: Option<NvdMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NvdDescription {
    pub lang: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvdMetrics {
    pub cvss_metric_v31: Option<Vec<NvdCvssMetric>>,
    pub cvss_metric_v30: Option<Vec<NvdCvssMetric>>,
    pub cvss_metric_v2: Option<Vec<NvdCvssMetricV2>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvdCvssMetric {
    pub source: Option<String>,
    #[serde(rename = "type")]
    pub metric_type: Option<String>,
    pub cvss_data: CvssData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CvssData {
    pub version: String,
    pub vector_string: String,
    pub base_score: f32,
    pub base_severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvdCvssMetricV2 {
    pub source: Option<String>,
    pub cvss_data: CvssDataV2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CvssDataV2 {
    pub version: String,
    pub vector_string: String,
    pub base_score: f32,
}

impl NvdCve {
    /// Extract the best available CVSS v3.1 (preferred) or v3.0 base score.
    pub fn best_cvss_v3(&self) -> Option<(f32, String)> {
        let metrics = self.metrics.as_ref()?;

        // Prefer v3.1, then v3.0
        let candidates = metrics
            .cvss_metric_v31
            .as_ref()
            .or(metrics.cvss_metric_v30.as_ref())?;

        // Prefer "Primary" type
        let metric = candidates
            .iter()
            .find(|m| m.metric_type.as_deref() == Some("Primary"))
            .or(candidates.first())?;

        Some((
            metric.cvss_data.base_score,
            metric.cvss_data.vector_string.clone(),
        ))
    }

    /// Extract English description.
    pub fn en_description(&self) -> Option<&str> {
        self.descriptions
            .as_ref()?
            .iter()
            .find(|d| d.lang == "en")
            .map(|d| d.value.as_str())
    }
}
