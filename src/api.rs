use crate::build;
use crate::config::Config;
use crate::storage::Storage;
use axum::{
    extract::{Multipart, Path, Query, State},
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
pub struct AllImagesQuery {
    #[serde(default)]
    offset: usize,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    5
}

#[derive(Debug, Deserialize)]
pub struct CreateBuildBody {
    pub name: String,
    pub interval_minutes: Option<u64>,
    pub script: String,
}

pub async fn index() -> Response {
    let html = include_str!("../frontend/index.html");
    Html(html).into_response()
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

pub async fn list_all_images(
    State(state): State<AppState>,
    Query(q): Query<AllImagesQuery>,
) -> impl IntoResponse {
    let limit = q.limit.min(50);
    match state.storage.list_all_grouped(q.offset, limit).await {
        Ok(groups) => {
            let items: Vec<serde_json::Value> = groups
                .into_iter()
                .map(|(date, images)| {
                    let list: Vec<ImageResponse> = images
                        .into_iter()
                        .map(|i| {
                            let filename = i.filename.clone();
                            ImageResponse {
                                filename: filename.clone(),
                                size: i.size,
                                modified: i.modified.to_rfc3339(),
                                url: format!("/api/download/{}/{}", date, filename),
                            }
                        })
                        .collect();
                    serde_json::json!({ "date": date, "images": list })
                })
                .collect();
            axum::Json(serde_json::json!({ "items": items, "has_more": items.len() >= limit }))
                .into_response()
        }
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
        Some(ref d) if !d.is_empty() => d.clone(),
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
                .map(|i| {
                    let filename = i.filename;
                    ImageResponse {
                        filename: filename.clone(),
                        size: i.size,
                        modified: i.modified.to_rfc3339(),
                        url: format!("/api/download/{}/{}", date, filename),
                    }
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

fn admin_token_from_headers(state: &AppState) -> Option<String> {
    state.config.admin_token.as_ref().cloned()
}

async fn require_admin(
    State(state): State<AppState>,
    token: Option<String>,
) -> Result<AppState, (StatusCode, axum::Json<serde_json::Value>)> {
    let expected = match admin_token_from_headers(&state) {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({ "error": "未配置管理员" })),
            ));
        }
    };
    let provided = token.as_deref().unwrap_or("");
    if provided.is_empty() || provided != expected {
        return Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({ "error": "无效的管理员令牌" })),
        ));
    }
    Ok(state)
}

/// 检查是否启用管理员功能（不校验令牌）
pub async fn admin_status(State(state): State<AppState>) -> impl IntoResponse {
    let enabled = state.config.admin_token.is_some();
    axum::Json(serde_json::json!({ "enabled": enabled }))
}

/// 验证管理员令牌
pub async fn admin_verify(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    match require_admin(State(state), token).await {
        Ok(_) => axum::Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 删除镜像（需管理员令牌）
pub async fn admin_delete_image(
    State(state): State<AppState>,
    Path((date, filename)): Path<(String, String)>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    match state.storage.delete_image(&date, &filename).await {
        Ok(()) => axum::Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// 上传镜像（需管理员令牌），按当前日期建目录，重名自动加后缀
pub async fn admin_upload(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut saved = Vec::new();

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let filename = match field.file_name().map(|s| s.to_string()) {
            Some(n) if !n.is_empty() => n,
            _ => continue,
        };
        let data = match field.bytes().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        match state.storage.save_uploaded(&date, &filename, &data).await {
            Ok(actual_name) => saved.push(serde_json::json!({ "date": date, "filename": actual_name })),
            Err(_) => {}
        }
    }

    axum::Json(serde_json::json!({ "saved": saved })).into_response()
}
