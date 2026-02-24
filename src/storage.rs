use chrono::{DateTime, Local};
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

    /// 获取所有镜像按日期分组，支持分页（每次返回 limit 个日期组）
    pub async fn list_all_grouped(
        &self,
        offset: usize,
        limit: usize,
    ) -> anyhow::Result<Vec<(String, Vec<ImageInfo>)>> {
        let dates = self.list_dates().await?;
        let mut result = Vec::new();
        for date in dates.into_iter().skip(offset).take(limit) {
            let images = self.list_images(&date).await?;
            if !images.is_empty() {
                result.push((date, images));
            }
        }
        Ok(result)
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

    /// 删除指定日期的镜像文件
    pub async fn delete_image(&self, date: &str, filename: &str) -> anyhow::Result<()> {
        if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
            anyhow::bail!("非法文件名");
        }
        let path = self.file_path(date, filename);
        if path.exists() {
            fs::remove_file(&path).await?;
        }
        Ok(())
    }

    /// 保存上传的文件到指定日期目录，若重名则自动加 _1、_2 等后缀
    pub async fn save_uploaded(&self, date: &str, suggested_name: &str, data: &[u8]) -> anyhow::Result<String> {
        if suggested_name.contains("..") || suggested_name.contains('/') || suggested_name.contains('\\') {
            anyhow::bail!("非法文件名");
        }
        let dir = self.root.join(date);
        fs::create_dir_all(&dir).await?;

        let (stem, ext) = match suggested_name.rfind('.') {
            Some(i) => (suggested_name[..i].to_string(), suggested_name[i..].to_string()),
            None => (suggested_name.to_string(), String::new()),
        };

        let mut filename = suggested_name.to_string();
        let mut n = 0u32;
        while self.file_path(date, &filename).exists() {
            n += 1;
            filename = format!("{}_{}{}", stem, n, ext);
        }

        let path = self.file_path(date, &filename);
        fs::write(&path, data).await?;
        Ok(filename)
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
