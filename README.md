# 系统镜像分发

按日期查看、下载每日构建的系统镜像，支持后台定时构建及脚本驱动的产物自动上传。

## 功能

- **按日期查看镜像**：选择日期浏览当日构建的镜像文件
- **下载**：一键下载镜像
- **定时构建**：在 `config.toml` 配置构建任务，按固定间隔自动执行
- **脚本构建**：构建脚本使用 shell，将产物放入 `output` 目录即可自动上传

## 技术栈

- **后端**：Rust (axum, tokio)
- **前端**：原生 HTML/CSS/JS

## 快速开始

### 运行

```bash
cargo run
```

默认访问 http://localhost:3000

### 配置

编辑 `config.toml`：

```toml
port = 3000
uploads_dir = "uploads"

[[builds]]
name = "daily-image"
interval_minutes = 60
script = """
#!/bin/bash
mkdir -p output
# 你的构建命令，将产物放到 output 目录
cp /path/to/image.iso output/
"""
```

### 手动触发构建

打开 `/builds` 页面，填写名称、间隔和脚本，点击「立即构建」。

## 目录结构

```
├── Cargo.toml
├── config.toml
├── src/
│   ├── main.rs
│   ├── api.rs
│   ├── build.rs
│   ├── config.rs
│   └── storage.rs
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── uploads/          # 构建产物按日期存储 (YYYY-MM-DD/)
```
