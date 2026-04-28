use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StatsFile {
    counts: HashMap<String, u64>,
}

/// 持久化下载次数（JSON 文件，位于 uploads 根目录旁或其中）
pub struct DownloadStats {
    inner: Mutex<StatsFile>,
    path: PathBuf,
}

impl DownloadStats {
    pub async fn load(path: PathBuf) -> anyhow::Result<Self> {
        let mut sf = StatsFile::default();
        if path.exists() {
            let txt = tokio::fs::read_to_string(&path).await?;
            if !txt.trim().is_empty() {
                sf = serde_json::from_str(&txt).unwrap_or_default();
            }
        }
        Ok(Self {
            inner: Mutex::new(sf),
            path,
        })
    }

    /// 统计键格式：`YYYY-MM-DD/文件名` 或 `stable/分类/文件名`
    pub async fn increment(&self, key: &str) -> anyhow::Result<()> {
        let mut g = self.inner.lock().await;
        *g.counts.entry(key.to_string()).or_insert(0) += 1;
        let json = serde_json::to_vec_pretty(&*g)?;
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&self.path, json).await?;
        Ok(())
    }

    pub async fn snapshot(&self) -> HashMap<String, u64> {
        let g = self.inner.lock().await;
        g.counts.clone()
    }
}
