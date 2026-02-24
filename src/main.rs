mod api;
mod build;
mod config;
mod storage;

use axum::{routing::get, Router};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Arc::new(config::Config::load()?);
    let storage = Arc::new(storage::Storage::new(config.uploads_dir.clone()));

    // 启动定时构建任务
    let build_handle = build::spawn_scheduler(config.clone(), storage.clone());

    let port = config.port;
    let app = Router::new()
        .route("/", get(api::index))
        .route("/builds", get(api::index))
        .route("/api/dates", get(api::list_dates))
        .route("/api/images", get(api::list_images))
        .route("/api/download/:date/:filename", get(api::download))
        .route("/api/builds", get(api::list_builds).post(api::create_build))
        .nest_service(
            "/static",
            tower_http::services::ServeDir::new("frontend"),
        )
        .layer(CorsLayer::permissive())
        .with_state(api::AppState { config, storage });

    let addr = ([0, 0, 0, 0], port).into();
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("服务已启动: http://{}", addr);

    axum::serve(listener, app).await?;

    build_handle.abort();
    Ok(())
}
