# 系统镜像分发

一个轻量的镜像分发服务：支持每日构建镜像展示、下载、管理员按条目维护（上传/删除/发布说明），以及脚本驱动的定时构建。

## 功能概览

- **镜像展示**
  - 按日期查看每日镜像
  - 固定发布（`stable`）侧栏展示
  - 支持分页加载（加载更多）
- **管理员能力（`/admin`）**
  - 管理员令牌登录
  - 每个日期条目内可直接：上传、删除、编辑当日发布说明
  - 固定发布条目可单独上传和删除
  - 置顶公告编辑
  - 手动触发构建、查看构建记录
- **上传能力**
  - 支持拖拽上传和文件选择上传
  - 后端采用**流式写盘**，避免大文件整块进内存
  - 默认请求体上限为 **2GB**
- **交互体验**
  - 下拉刷新（含加载状态）
  - 加载更多按钮加载中视觉反馈

## 技术栈

- 后端：Rust + axum + tokio
- 前端：原生 HTML/CSS/JS

## 快速开始

### 1) 运行服务

```bash
cargo run
# 指定监听地址与端口
cargo run -- --host 127.0.0.1 --port 8080
# 简写
cargo run -- -h 0.0.0.0 -p 3000
```

默认访问 [http://localhost:3000](http://localhost:3000)。

### 2) 配置 `config.toml`

首次运行若无 `config.toml`，程序会自动生成默认配置。

```toml
port = 3000
uploads_dir = "uploads"
admin_token = "your-admin-token"

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

说明：
- `admin_token` 配置后，`/admin` 可进行上传/删除/编辑说明等管理操作
- `uploads_dir` 默认是 `uploads/`，镜像按日期目录存放（`YYYY-MM-DD/`）

### 3) 管理入口

- 普通查看：`/`
- 管理页面：`/admin`

## 测试

```bash
cargo test
```

当前已覆盖 `src` 目录核心模块（`config`、`storage`、`build`、`api`）的基础单元测试。

## 容器镜像

```bash
./scripts/build-container.sh [镜像名] [标签]
# 示例
./scripts/build-container.sh image-dist v1.0
docker run -p 3000:3000 -v $(pwd)/uploads:/app/uploads image-dist:v1.0
```

## 目录结构

```text
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
├── scripts/
│   ├── build-container.sh
│   └── example-build.sh
└── uploads/          # 产物目录（stable/ 与 YYYY-MM-DD/）
```
