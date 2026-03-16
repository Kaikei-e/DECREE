use axum::http::StatusCode;
use serde::Serialize;

use crate::error::ScannerError;

#[derive(Debug, Serialize)]
pub struct ConnectError {
    pub code: ConnectCode,
    pub message: String,
}

impl From<ScannerError> for ConnectError {
    fn from(err: ScannerError) -> Self {
        ConnectError {
            code: ConnectCode::Internal,
            message: err.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectCode {
    InvalidArgument,
    NotFound,
    Internal,
    Unimplemented,
    Unavailable,
}

impl ConnectCode {
    pub fn http_status(self) -> StatusCode {
        match self {
            Self::InvalidArgument => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Unimplemented => StatusCode::NOT_FOUND,
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_error_serializes_to_spec_format() {
        let err = ConnectError {
            code: ConnectCode::NotFound,
            message: "scan job not found".to_string(),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"code":"not_found","message":"scan job not found"}"#
        );
    }

    #[test]
    fn connect_code_http_status_mapping() {
        assert_eq!(
            ConnectCode::InvalidArgument.http_status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(ConnectCode::NotFound.http_status(), StatusCode::NOT_FOUND);
        assert_eq!(
            ConnectCode::Internal.http_status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            ConnectCode::Unavailable.http_status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
