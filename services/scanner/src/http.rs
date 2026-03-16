use std::time::Duration;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "decree-scanner/0.1";

pub fn default_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(DEFAULT_TIMEOUT)
        .build()
        .expect("failed to build HTTP client")
}
