use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_uploads")]
    pub uploads_dir: PathBuf,
    #[serde(default)]
    pub builds: Vec<BuildConfig>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BuildConfig {
    pub name: String,
    #[serde(default = "default_interval")]
    pub interval_minutes: u64,
    pub script: String,
}

fn default_port() -> u16 {
    3000
}

fn default_uploads() -> PathBuf {
    PathBuf::from("uploads")
}

fn default_interval() -> u64 {
    60
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let path = PathBuf::from("config.toml");
        let content = if path.exists() {
            std::fs::read_to_string(&path)?
        } else {
            let default = Self::default_config();
            std::fs::write(&path, default)?;
            default
        };
        Ok(toml::from_str(&content)?)
    }
}

impl Config {
    fn default_config() -> String {
        r#"port = 3000
uploads_dir = "uploads"

[[builds]]
name = "example"
interval_minutes = 60
script = """
#!/bin/bash
echo 'Build started at $(date)'
mkdir -p output
echo 'sample content' > output/sample.txt
"""
"#
        .to_string()
    }
}
