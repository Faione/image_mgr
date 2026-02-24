use crate::build;
use crate::config::Config;
use crate::storage::Storage;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub storage: Arc<Storage>,
}

#[derive(Debug, Deserialize)]
pub struct DateQuery {
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBuildBody {
    pub name: String,
    pub interval_minutes: Option<u64>,
    pub script: String,
}

pub async fn index() -> Response {
    match tokio::fs::read_to_string("frontend/index.html").await {
        Ok(html) => Html(html).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "前端文件未找到").into_response(),
    }
}

pub async fn list_dates(State(state): State<AppState>) -> impl IntoResponse {
    match state.storage.list_dates().await {
        Ok(dates) => axum::Json(dates).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

pub async fn list_images(
    State(state): State<AppState>,
    Query(q): Query<DateQuery>,
) -> impl IntoResponse {
    let date = match q.date {
        Some(d) if !d.is_empty() => d,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "缺少 date 参数" })),
            )
                .into_response()
        }
    };

    match state.storage.list_images(&date).await {
        Ok(images) => {
            let list: Vec<ImageResponse> = images
                .into_iter()
                .map(|i| ImageResponse {
                    filename: i.filename,
                    size: i.size,
                    modified: i.modified.to_rfc3339(),
                    url: format!("/api/download/{}/{}", date, i.filename),
                })
                .collect();
            axum::Json(list).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

#[derive(serde::Serialize)]
struct ImageResponse {
    filename: String,
    size: u64,
    modified: String,
    url: String,
}

pub async fn download(
    State(state): State<AppState>,
    Path((date, filename)): Path<(String, String)>,
) -> Response {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return (StatusCode::BAD_REQUEST, "非法文件名").into_response();
    }
    let path = state.storage.file_path(&date, &filename);
    if !path.exists() {
        return (StatusCode::NOT_FOUND, "文件不存在").into_response();
    }
    match tokio::fs::read(&path).await {
        Ok(data) => (
            [
                ("Content-Type", "application/octet-stream"),
                (
                    "Content-Disposition",
                    &format!("attachment; filename=\"{}\"", filename),
                ),
            ],
            data,
        )
            .into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "读取文件失败").into_response(),
    }
}

pub async fn list_builds() -> impl IntoResponse {
    let log = build::get_build_log();
    axum::Json(log)
}

pub async fn create_build(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<CreateBuildBody>,
) -> impl IntoResponse {
    let cfg = crate::config::BuildConfig {
        name: body.name,
        interval_minutes: body.interval_minutes.unwrap_or(60),
        script: body.script,
    };
    let storage = state.storage.clone();
    tokio::spawn(async move {
        let _ = build::run_build(&cfg, &storage).await;
    });
    (StatusCode::ACCEPTED, axum::Json(serde_json::json!({ "status": "构建已启动" })))
}
