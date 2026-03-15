use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use super::error::ConnectError;

pub fn connect_response<T: Serialize>(result: Result<T, ConnectError>) -> Response {
    match result {
        Ok(body) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            Json(body),
        )
            .into_response(),
        Err(err) => {
            let status = err.code.http_status();
            (status, Json(err)).into_response()
        }
    }
}
