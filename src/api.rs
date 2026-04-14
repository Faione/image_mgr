use crate::build;
use crate::config::Config;
use crate::storage::Storage;
use axum::{
    extract::{FromRequest, Multipart, Path, Query, Request, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::{fs::File, io::AsyncWriteExt};
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
pub struct UploadTargetQuery {
    /// 为 "stable" 时上传到固定发布栏，否则上传到当日目录
    target: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBuildBody {
    pub name: String,
    pub interval_minutes: Option<u64>,
    pub script: String,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseNotesQuery {
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnnouncementBody {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseNotesBody {
    pub date: String,
    pub content: String,
}

pub async fn index() -> Response {
    let html = include_str!("../frontend/index.html");
    Html(html).into_response()
}

/// 站点更新公告（公开）
pub async fn get_announcement(State(state): State<AppState>) -> impl IntoResponse {
    let content = state.storage.get_announcement().await;
    axum::Json(serde_json::json!({ "content": content }))
}

/// 指定日期的发布说明（公开）
pub async fn get_release_notes(
    State(state): State<AppState>,
    Query(q): Query<ReleaseNotesQuery>,
) -> impl IntoResponse {
    let date = match q.date {
        Some(ref d) if !d.is_empty() => d.clone(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "缺少 date 参数" })),
            )
                .into_response();
        }
    };
    match state.storage.get_release_notes(&date).await {
        Ok(n) => {
            axum::Json(serde_json::json!({ "content": n.unwrap_or_default() })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
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

pub async fn list_all_images(
    State(state): State<AppState>,
    Query(q): Query<AllImagesQuery>,
) -> impl IntoResponse {
    let limit = q.limit.min(50);
    match state.storage.list_all_grouped(q.offset, limit).await {
        Ok(groups) => {
            let mut items = Vec::new();
            for (date, images) in groups {
                let notes = state
                    .storage
                    .get_release_notes(&date)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_default();
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
                items.push(serde_json::json!({
                    "date": date,
                    "images": list,
                    "notes": notes,
                }));
            }
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

/// 固定发布栏镜像列表（非按日期，仅管理员维护）
pub async fn list_stable_images(State(state): State<AppState>) -> impl IntoResponse {
    const STABLE: &str = "stable";
    match state.storage.list_images(STABLE).await {
        Ok(images) => {
            let list: Vec<ImageResponse> = images
                .into_iter()
                .map(|i| {
                    let filename = i.filename.clone();
                    ImageResponse {
                        filename: filename.clone(),
                        size: i.size,
                        modified: i.modified.to_rfc3339(),
                        url: format!("/api/download/{}/{}", STABLE, filename),
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

/// 构建日志（需管理员令牌）
pub async fn list_builds(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let _state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let log = build::get_build_log();
    axum::Json(log).into_response()
}

/// 手动触发构建（需管理员令牌）
pub async fn create_build(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::Json(body): axum::Json<CreateBuildBody>,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let cfg = crate::config::BuildConfig {
        name: body.name,
        interval_minutes: body.interval_minutes.unwrap_or(60),
        script: body.script,
    };
    let storage = state.storage.clone();
    tokio::spawn(async move {
        let _ = build::run_build(&cfg, &storage).await;
    });
    (
        StatusCode::ACCEPTED,
        axum::Json(serde_json::json!({ "status": "构建已启动" })),
    )
        .into_response()
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

/// 上传镜像（需管理员令牌）。默认按当前日期建目录；?target=stable 时上传到固定发布栏
pub async fn admin_upload(
    State(state): State<AppState>,
    Query(q): Query<UploadTargetQuery>,
    request: Request,
) -> impl IntoResponse {
    let token = request
        .headers()
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    let mut multipart = match Multipart::from_request(request, &state).await {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": format!("无效的请求体: {}", e) })),
            )
                .into_response()
        }
    };

    let date = if q.target.as_deref() == Some("stable") {
        "stable".to_string()
    } else if let Some(t) = q.target {
        t
    } else {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    };
    let mut saved = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let filename = match field.file_name().map(|s: &str| s.to_string()) {
            Some(n) if !n.is_empty() => n,
            _ => continue,
        };
        let (actual_name, path) = match state.storage.prepare_upload_path(&date, &filename).await {
            Ok(v) => v,
            Err(_) => continue,
        };

        let mut out = match File::create(&path).await {
            Ok(f) => f,
            Err(_) => continue,
        };

        let mut field = field;
        let mut ok = true;
        while let Ok(Some(chunk)) = field.chunk().await {
            if out.write_all(&chunk).await.is_err() {
                ok = false;
                break;
            }
        }
        if out.flush().await.is_err() {
            ok = false;
        }
        if ok {
            saved.push(serde_json::json!({ "date": date, "filename": actual_name }));
        } else {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    axum::Json(serde_json::json!({ "saved": saved })).into_response()
}

/// 保存站点更新公告（需管理员令牌）
pub async fn admin_set_announcement(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::Json(body): axum::Json<AnnouncementBody>,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match state.storage.set_announcement(&body.content).await {
        Ok(()) => axum::Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// 保存某日期的发布说明（需管理员令牌，留空则删除）
pub async fn admin_set_release_notes(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::Json(body): axum::Json<ReleaseNotesBody>,
) -> impl IntoResponse {
    let token = headers
        .get("X-Admin-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let state = match require_admin(State(state), token).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match state
        .storage
        .set_release_notes(&body.date, &body.content)
        .await
    {
        Ok(()) => axum::Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}_{}", prefix, std::process::id(), nanos))
    }

    async fn make_state(admin_token: Option<&str>) -> AppState {
        let root = unique_temp_dir("api_test_storage");
        tokio::fs::create_dir_all(&root)
            .await
            .expect("create api test storage");
        AppState {
            config: Arc::new(Config {
                port: 3000,
                uploads_dir: root.clone(),
                builds: Vec::new(),
                admin_token: admin_token.map(|s| s.to_string()),
            }),
            storage: Arc::new(Storage::new(root)),
        }
    }

    #[tokio::test]
    async fn admin_status_reflects_token_presence() {
        let state_without = make_state(None).await;
        let resp_without = admin_status(State(state_without)).await.into_response();
        assert_eq!(resp_without.status(), StatusCode::OK);

        let state_with = make_state(Some("secret")).await;
        let resp_with = admin_status(State(state_with)).await.into_response();
        assert_eq!(resp_with.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn get_release_notes_requires_date_query() {
        let state = make_state(None).await;
        let resp = get_release_notes(State(state), Query(ReleaseNotesQuery { date: None }))
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn admin_verify_rejects_wrong_token() {
        let state = make_state(Some("secret")).await;
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("X-Admin-Token", HeaderValue::from_static("wrong"));
        let resp = admin_verify(State(state), headers).await.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admin_verify_accepts_correct_token() {
        let state = make_state(Some("secret")).await;
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("X-Admin-Token", HeaderValue::from_static("secret"));
        let resp = admin_verify(State(state), headers).await.into_response();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
