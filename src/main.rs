mod api;
mod build;
mod config;
mod storage;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post},
    Router,
};
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;

#[derive(Parser, Debug)]
#[command(name = "image-dist", about = "系统镜像分发服务")]
struct Args {
    /// 监听地址
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    /// 监听端口（未指定时使用 config.toml 中的 port）
    #[arg(short, long)]
    port: Option<u16>,
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let config = Arc::new(config::Config::load()?);
    let storage = Arc::new(storage::Storage::new(config.uploads_dir.clone()));

    let build_handle = build::spawn_scheduler(config.clone(), storage.clone());

    let port = args.port.unwrap_or(config.port);
    let addr: SocketAddr = format!("{}:{}", args.host, port).parse()?;

    let frontend_dir: PathBuf = std::env::var("FRONTEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| [env!("CARGO_MANIFEST_DIR"), "frontend"].iter().collect());
    let app = Router::new()
        .route("/", get(api::index))
        .route("/admin", get(api::index))
        .route("/api/dates", get(api::list_dates))
        .route("/api/images", get(api::list_images))
        .route("/api/images/stable", get(api::list_stable_images))
        .route("/api/images/all", get(api::list_all_images))
        .route("/api/download/:date/:filename", get(api::download))
        .route("/api/builds", get(api::list_builds).post(api::create_build))
        .route("/api/admin/status", get(api::admin_status))
        .route("/api/admin/verify", get(api::admin_verify))
        .route("/api/admin/image/:date/:filename", delete(api::admin_delete_image))
        .route("/api/admin/upload", post(api::admin_upload))
        .nest_service(
            "/static",
            tower_http::services::ServeDir::new(frontend_dir),
        )
        .layer(DefaultBodyLimit::disable()) // 关闭 axum 默认 2MB 限制，否则大文件上传会 Failed to fetch
        .layer(RequestBodyLimitLayer::new(256 * 1024 * 1024)) // 256MB 上限
        .layer(CorsLayer::permissive())
        .with_state(api::AppState { config, storage });

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("服务已启动: http://{}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    build_handle.abort();
    Ok(())
}
