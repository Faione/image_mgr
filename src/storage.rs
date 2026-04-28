use chrono::{DateTime, Local};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone)]
pub struct ImageInfo {
    pub filename: String,
    pub size: u64,
    pub modified: DateTime<Local>,
}

/// 每日构建发布说明文件名（不出现在镜像列表中）
pub const RELEASE_NOTES_FILENAME: &str = "release_notes.txt";

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
                    if name.chars().all(|c| c.is_ascii_digit() || c == '-') && name.len() == 10 {
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
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name == RELEASE_NOTES_FILENAME {
                    continue;
                }
                let meta = fs::metadata(&path).await?;
                let modified: DateTime<Local> = meta.modified()?.into();
                images.push(ImageInfo {
                    filename: name.to_string(),
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

    /// 仅分配一个可写入的安全路径，不执行文件写入
    pub async fn prepare_upload_path(
        &self,
        date: &str,
        suggested_name: &str,
    ) -> anyhow::Result<(String, PathBuf)> {
        if suggested_name.contains("..")
            || suggested_name.contains('/')
            || suggested_name.contains('\\')
        {
            anyhow::bail!("非法文件名");
        }
        if suggested_name == RELEASE_NOTES_FILENAME {
            anyhow::bail!("发布说明请通过管理页的「发布说明」保存");
        }
        let dir = self.root.join(date);
        fs::create_dir_all(&dir).await?;

        let (stem, ext) = match suggested_name.rfind('.') {
            Some(i) => (
                suggested_name[..i].to_string(),
                suggested_name[i..].to_string(),
            ),
            None => (suggested_name.to_string(), String::new()),
        };

        let mut filename = suggested_name.to_string();
        let mut n = 0u32;
        while self.file_path(date, &filename).exists() {
            n += 1;
            filename = format!("{}_{}{}", stem, n, ext);
        }

        let path = self.file_path(date, &filename);
        Ok((filename, path))
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

    fn announcement_path(&self) -> PathBuf {
        self.root.join(".site_announcement")
    }

    pub async fn get_announcement(&self) -> String {
        match fs::read_to_string(self.announcement_path()).await {
            Ok(s) => s.trim().to_string(),
            Err(_) => String::new(),
        }
    }

    pub async fn set_announcement(&self, content: &str) -> anyhow::Result<()> {
        fs::create_dir_all(&self.root).await?;
        fs::write(self.announcement_path(), content).await?;
        Ok(())
    }

    fn release_notes_path(&self, date: &str) -> PathBuf {
        self.root.join(date).join(RELEASE_NOTES_FILENAME)
    }

    pub async fn get_release_notes(&self, date: &str) -> anyhow::Result<Option<String>> {
        let p = self.release_notes_path(date);
        if !p.exists() {
            return Ok(None);
        }
        Ok(Some(fs::read_to_string(&p).await?))
    }

    pub async fn set_release_notes(&self, date: &str, content: &str) -> anyhow::Result<()> {
        if !Self::is_valid_date_dir(date) {
            anyhow::bail!("仅支持 YYYY-MM-DD 日期目录");
        }
        let p = self.release_notes_path(date);
        if content.trim().is_empty() {
            if p.exists() {
                fs::remove_file(&p).await?;
            }
            return Ok(());
        }
        let dir = self.root.join(date);
        fs::create_dir_all(&dir).await?;
        fs::write(&p, content).await?;
        Ok(())
    }

    fn is_valid_date_dir(name: &str) -> bool {
        name.len() == 10 && name.chars().all(|c| c.is_ascii_digit() || c == '-') && name != "stable"
    }

    pub fn stable_root(&self) -> PathBuf {
        self.root.join("stable")
    }

    /// 将旧版「直接写在 stable 根目录」的文件迁入 `stable/default/`
    pub async fn migrate_stable_flat_files(&self) -> anyhow::Result<()> {
        let stable = self.stable_root();
        if !stable.is_dir() {
            return Ok(());
        }
        let default_dir = stable.join("default");
        let mut entries = fs::read_dir(&stable).await?;
        let mut files = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') && name != RELEASE_NOTES_FILENAME {
                        files.push(name.to_string());
                    }
                }
            }
        }
        if files.is_empty() {
            return Ok(());
        }
        fs::create_dir_all(&default_dir).await?;
        for name in files {
            let from = stable.join(&name);
            let to = default_dir.join(&name);
            if !to.exists() {
                fs::rename(&from, &to).await?;
            }
        }
        Ok(())
    }

    pub fn is_valid_stable_category_slug(s: &str) -> bool {
        if s.is_empty() || s.len() > 64 {
            return false;
        }
        if s.starts_with('.') {
            return false;
        }
        s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    }

    /// `stable/<category>/` 下列出镜像文件
    pub async fn list_stable_category_images(&self, category: &str) -> anyhow::Result<Vec<ImageInfo>> {
        if !Self::is_valid_stable_category_slug(category) {
            anyhow::bail!("非法分类标识");
        }
        let dir = self.stable_root().join(category);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut images = Vec::new();
        let mut entries = fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name == RELEASE_NOTES_FILENAME {
                    continue;
                }
                let meta = fs::metadata(&path).await?;
                let modified: DateTime<Local> = meta.modified()?.into();
                images.push(ImageInfo {
                    filename: name.to_string(),
                    size: meta.len(),
                    modified,
                });
            }
        }
        images.sort_by_key(|i| std::cmp::Reverse(i.modified));
        Ok(images)
    }

    /// 返回 sorted 的分类目录名列表（仅一层子目录）
    pub async fn list_stable_categories(&self) -> anyhow::Result<Vec<String>> {
        let stable = self.stable_root();
        if !stable.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let mut entries = fs::read_dir(&stable).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') && Self::is_valid_stable_category_slug(name) {
                        out.push(name.to_string());
                    }
                }
            }
        }
        out.sort();
        Ok(out)
    }

    pub fn stable_file_path(&self, category: &str, filename: &str) -> PathBuf {
        self.stable_root().join(category).join(filename)
    }

    pub async fn ensure_stable_category(&self, category: &str) -> anyhow::Result<()> {
        if !Self::is_valid_stable_category_slug(category) {
            anyhow::bail!("非法分类标识");
        }
        let dir = self.stable_root().join(category);
        fs::create_dir_all(&dir).await?;
        Ok(())
    }

    pub async fn prepare_upload_path_stable(
        &self,
        category: &str,
        suggested_name: &str,
    ) -> anyhow::Result<(String, PathBuf)> {
        if !Self::is_valid_stable_category_slug(category) {
            anyhow::bail!("非法分类标识");
        }
        if suggested_name.contains("..")
            || suggested_name.contains('/')
            || suggested_name.contains('\\')
        {
            anyhow::bail!("非法文件名");
        }
        if suggested_name == RELEASE_NOTES_FILENAME {
            anyhow::bail!("请勿上传该文件名");
        }
        let dir = self.stable_root().join(category);
        fs::create_dir_all(&dir).await?;

        let (stem, ext) = match suggested_name.rfind('.') {
            Some(i) => (
                suggested_name[..i].to_string(),
                suggested_name[i..].to_string(),
            ),
            None => (suggested_name.to_string(), String::new()),
        };

        let mut filename = suggested_name.to_string();
        let mut n = 0u32;
        while self.stable_file_path(category, &filename).exists() {
            n += 1;
            filename = format!("{}_{}{}", stem, n, ext);
        }
        let path = self.stable_file_path(category, &filename);
        Ok((filename, path))
    }

    pub async fn delete_stable_image(&self, category: &str, filename: &str) -> anyhow::Result<()> {
        if !Self::is_valid_stable_category_slug(category) {
            anyhow::bail!("非法分类标识");
        }
        if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
            anyhow::bail!("非法文件名");
        }
        let path = self.stable_file_path(category, filename);
        if path.exists() {
            fs::remove_file(&path).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}_{}", prefix, std::process::id(), nanos))
    }

    #[tokio::test]
    async fn list_dates_only_returns_valid_yyyy_mm_dd_dirs() {
        let root = unique_temp_dir("storage_dates_test");
        fs::create_dir_all(root.join("2026-04-14"))
            .await
            .expect("create valid dir");
        fs::create_dir_all(root.join("2026-03-01"))
            .await
            .expect("create valid dir");
        fs::create_dir_all(root.join("stable"))
            .await
            .expect("create stable dir");
        fs::create_dir_all(root.join("not-a-date"))
            .await
            .expect("create invalid dir");

        let storage = Storage::new(root.clone());
        let dates = storage.list_dates().await.expect("list dates");
        assert_eq!(
            dates,
            vec!["2026-04-14".to_string(), "2026-03-01".to_string()]
        );

        let _ = fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn list_images_ignores_release_notes_file() {
        let root = unique_temp_dir("storage_list_images_test");
        let day_dir = root.join("2026-04-14");
        fs::create_dir_all(&day_dir).await.expect("create day dir");
        fs::write(day_dir.join("a.img"), b"abc")
            .await
            .expect("write image");
        fs::write(day_dir.join(RELEASE_NOTES_FILENAME), b"notes")
            .await
            .expect("write release notes");

        let storage = Storage::new(root.clone());
        let images = storage
            .list_images("2026-04-14")
            .await
            .expect("list images");
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].filename, "a.img");

        let _ = fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn prepare_upload_path_renames_duplicate_files() {
        let root = unique_temp_dir("storage_prepare_upload_test");
        let day_dir = root.join("2026-04-14");
        fs::create_dir_all(&day_dir).await.expect("create day dir");
        fs::write(day_dir.join("image.iso"), b"old")
            .await
            .expect("write existing file");

        let storage = Storage::new(root.clone());
        let (name, path) = storage
            .prepare_upload_path("2026-04-14", "image.iso")
            .await
            .expect("prepare upload path");
        assert_eq!(name, "image_1.iso");
        assert!(path.ends_with("image_1.iso"));

        let err = storage
            .prepare_upload_path("2026-04-14", "../bad.iso")
            .await
            .expect_err("invalid filename should fail");
        assert!(err.to_string().contains("非法文件名"));

        let _ = fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn release_notes_roundtrip_and_clear() {
        let root = unique_temp_dir("storage_notes_test");
        let storage = Storage::new(root.clone());

        storage
            .set_release_notes("2026-04-14", "first release")
            .await
            .expect("set notes");
        let got = storage
            .get_release_notes("2026-04-14")
            .await
            .expect("get notes");
        assert_eq!(got.as_deref(), Some("first release"));

        storage
            .set_release_notes("2026-04-14", "   ")
            .await
            .expect("clear notes");
        let got2 = storage
            .get_release_notes("2026-04-14")
            .await
            .expect("get cleared notes");
        assert!(got2.is_none());

        let invalid = storage
            .set_release_notes("stable", "bad")
            .await
            .expect_err("stable should be rejected");
        assert!(invalid.to_string().contains("YYYY-MM-DD"));

        let _ = fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn announcement_roundtrip() {
        let root = unique_temp_dir("storage_announcement_test");
        let storage = Storage::new(root.clone());
        storage
            .set_announcement("hello world")
            .await
            .expect("set announcement");
        let got = storage.get_announcement().await;
        assert_eq!(got, "hello world");
        let _ = fs::remove_dir_all(root).await;
    }
}
