use chrono::{DateTime, Local};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone)]
pub struct ImageInfo {
    pub filename: String,
    pub size: u64,
    pub modified: DateTime<Local>,
}

pub struct Storage {
    root: PathBuf,
}

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 获取所有有镜像的日期列表（YYYY-MM-DD）
    pub async fn list_dates(&self) -> anyhow::Result<Vec<String>> {
        let mut dates = Vec::new();
        let mut entries = fs::read_dir(&self.root).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.chars().all(|c| c.is_ascii_digit() || c == '-')
                        && name.len() == 10
                    {
                        dates.push(name.to_string());
                    }
                }
            }
        }
        dates.sort_by(|a, b| b.cmp(a));
        Ok(dates)
    }

    /// 获取指定日期的镜像列表
    pub async fn list_images(&self, date: &str) -> anyhow::Result<Vec<ImageInfo>> {
        let dir = self.root.join(date);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut images = Vec::new();
        let mut entries = fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                let meta = fs::metadata(&path).await?;
                let modified: DateTime<Local> = meta.modified()?.into();
                images.push(ImageInfo {
                    filename: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string(),
                    size: meta.len(),
                    modified,
                });
            }
        }
        images.sort_by_key(|i| std::cmp::Reverse(i.modified));
        Ok(images)
    }

    /// 获取镜像文件的完整路径
    pub fn file_path(&self, date: &str, filename: &str) -> PathBuf {
        self.root.join(date).join(filename)
    }

    /// 确保目录存在并保存构建产物
    pub async fn save_build_artifacts(
        &self,
        date: &str,
        source_dir: &Path,
    ) -> anyhow::Result<Vec<String>> {
        let dest_dir = self.root.join(date);
        fs::create_dir_all(&dest_dir).await?;

        let mut saved = Vec::new();
        let mut entries = fs::read_dir(source_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                let dest = dest_dir.join(&name);
                fs::copy(&path, &dest).await?;
                saved.push(name);
            }
        }
        Ok(saved)
    }
}
