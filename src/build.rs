use crate::config::{Config, BuildConfig};
use crate::storage::Storage;
use chrono::Local;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::time::{interval, Duration};

#[derive(Debug, Clone, serde::Serialize)]
pub struct BuildRecord {
    pub name: String,
    pub status: String,
    pub output_dir: PathBuf,
    pub artifacts: Vec<String>,
    pub time: String,
}

use std::sync::OnceLock;
static BUILD_LOG: OnceLock<std::sync::Mutex<Vec<BuildRecord>>> = OnceLock::new();

fn get_build_log_mutex() -> &'static std::sync::Mutex<Vec<BuildRecord>> {
    BUILD_LOG.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

pub fn spawn_scheduler(config: Arc<Config>, storage: Arc<Storage>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        for build_cfg in &config.builds {
            let cfg = build_cfg.clone();
            let conf = config.clone();
            let stor = storage.clone();
            tokio::spawn(async move {
                run_build_loop(cfg, conf, stor).await;
            });
        }
    })
}

async fn run_build_loop(cfg: BuildConfig, _config: Arc<Config>, storage: Arc<Storage>) {
    let mut tick = interval(Duration::from_secs(cfg.interval_minutes * 60));
    loop {
        tick.tick().await;
        if let Err(e) = run_build(&cfg, &storage).await {
            eprintln!("构建失败 {}: {}", cfg.name, e);
        }
    }
}

pub async fn run_build(cfg: &BuildConfig, storage: &Storage) -> anyhow::Result<Vec<String>> {
    let date = Local::now().format("%Y-%m-%d").to_string();
    let output_dir = std::env::temp_dir().join(format!("build_{}_{}", cfg.name, date));

    tokio::fs::create_dir_all(&output_dir).await?;

    let script_path = output_dir.join("build.sh");
    let script = cfg.script.trim().trim_matches('"');
    tokio::fs::write(&script_path, script).await?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(&script_path).await?.permissions();
        perms.set_mode(0o755);
        tokio::fs::set_permissions(&script_path, perms).await?;
    }

    let output = Command::new("sh")
        .arg(script_path.to_str().unwrap_or("build.sh"))
        .current_dir(&output_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let artifacts = if output.status.success() {
        let output_sub = output_dir.join("output");
        let (artifacts, status) = if output_sub.exists() {
            let a = storage.save_build_artifacts(&date, &output_sub).await?;
            (a, "success")
        } else {
            (Vec::new(), "no_output")
        };

        let _ = get_build_log_mutex().lock().map(|mut log| {
            log.push(BuildRecord {
                name: cfg.name.clone(),
                status: status.to_string(),
                output_dir: output_dir.clone(),
                artifacts: artifacts.clone(),
                time: Local::now().to_rfc3339(),
            });
            if log.len() > 100 {
                log.remove(0);
            }
        });
        artifacts
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("Build stderr: {}", stderr);
        let _ = get_build_log_mutex().lock().map(|mut log| {
            log.push(BuildRecord {
                name: cfg.name.clone(),
                status: format!("failed: {}", stderr.lines().next().unwrap_or("unknown")),
                output_dir: output_dir,
                artifacts: Vec::new(),
                time: Local::now().to_rfc3339(),
            });
        });
        return Err(anyhow::anyhow!("构建脚本执行失败"));
    };

    Ok(artifacts)
}

pub fn get_build_log() -> Vec<BuildRecord> {
    get_build_log_mutex()
        .lock()
        .map(|log| log.clone())
        .unwrap_or_default()
}
