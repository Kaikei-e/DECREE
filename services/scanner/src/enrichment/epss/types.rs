use serde::Deserialize;

/// Response from the FIRST EPSS API.
#[derive(Debug, Deserialize)]
pub struct EpssApiResponse {
    pub status: String,
    #[serde(rename = "status-code")]
    pub status_code: u16,
    pub total: u32,
    pub data: Vec<EpssEntry>,
}

/// A single CVE entry from the EPSS API.
#[derive(Debug, Clone, Deserialize)]
pub struct EpssEntry {
    pub cve: String,
    #[serde(deserialize_with = "deserialize_f32_from_str")]
    pub epss: f32,
    #[serde(deserialize_with = "deserialize_f32_from_str")]
    pub percentile: f32,
    pub date: String,
}

fn deserialize_f32_from_str<'de, D>(deserializer: D) -> std::result::Result<f32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    s.parse::<f32>().map_err(serde::de::Error::custom)
}
