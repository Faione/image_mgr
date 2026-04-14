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

## API 简表

### 公开接口

- `GET /api/dates`：返回可用日期列表
- `GET /api/images?date=YYYY-MM-DD`：返回某日镜像列表
- `GET /api/images/stable`：返回固定发布镜像列表
- `GET /api/images/all?offset=0&limit=5`：按日期分页返回镜像分组
- `GET /api/release-notes?date=YYYY-MM-DD`：返回某日发布说明
- `GET /api/announcement`：返回站点公告
- `GET /api/download/:date/:filename`：下载指定文件

### 管理接口（需 `X-Admin-Token`）

- `GET /api/admin/status`：查看管理员功能是否启用
- `GET /api/admin/verify`：验证管理员令牌
- `DELETE /api/admin/image/:date/:filename`：删除镜像文件
- `POST /api/admin/upload?target=stable|YYYY-MM-DD`：上传文件到固定发布或指定日期
- `POST /api/admin/announcement`：保存站点公告
- `POST /api/admin/release-notes`：保存当日发布说明
- `GET /api/builds`：查询构建记录
- `POST /api/builds`：手动触发构建

### 请求示例

```bash
# 1) 验证管理员 token
curl -H "X-Admin-Token: your-admin-token" \
  http://localhost:3000/api/admin/verify

# 2) 上传到固定发布（stable）
curl -X POST \
  -H "X-Admin-Token: your-admin-token" \
  -F "file=@/path/to/image.iso" \
  "http://localhost:3000/api/admin/upload?target=stable"

# 3) 保存某日发布说明
curl -X POST \
  -H "X-Admin-Token: your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-04-14","content":"本次修复了上传与刷新交互。"}' \
  http://localhost:3000/api/admin/release-notes
```

## 常见错误码与排查

- `400 Bad Request`
  - 场景：缺少必要参数（如 `date`）、请求体格式错误、非法文件名
  - 排查：检查 query/body 字段；文件名不要包含 `..`、`/`、`\`
- `401 Unauthorized`
  - 场景：管理员接口未带 token 或 token 错误
  - 排查：确认请求头 `X-Admin-Token` 与 `config.toml` 中 `admin_token` 一致
- `404 Not Found`
  - 场景：下载目标文件不存在、未配置管理员功能但访问管理员能力
  - 排查：确认文件是否已上传到对应日期目录；确认已配置 `admin_token`
- `413 Payload Too Large`
  - 场景：上传文件超过服务端允许大小
  - 当前默认上限：`2GB`（`RequestBodyLimitLayer`）
  - 排查：压缩拆分文件，或按需调高服务端限制
- `500 Internal Server Error`
  - 场景：磁盘写入失败、权限不足、构建脚本异常等
  - 排查：查看服务日志，检查 `uploads_dir` 读写权限、磁盘空间和脚本执行环境

## 运维建议

- 上传大文件建议：
  - 优先使用有线/稳定网络，避免中断
  - 上传前确认目标磁盘剩余空间（至少大于文件体积）
- 构建脚本建议：
  - 明确 `set -e` 以便失败快速退出
  - 产物统一输出到 `output/` 目录，避免遗漏
- 生产部署建议：
  - 固定 `uploads_dir` 挂载到持久卷
  - 将 `admin_token` 设为高强度随机字符串，并妥善保管

## 本次迭代变更记录

- 前端交互
  - 删除按钮统一为高对比红色样式
  - 镜像条目结构优化：文件名、大小、修改时间分层展示
  - 下拉刷新与加载更多增加明确加载状态（含旋转图标）
  - 刷新完成后增加短暂的“已更新”反馈
- 管理页能力
  - 每日发布说明从全局编辑迁移为“按日期条目内编辑”
  - 每个日期条目新增“管理”入口，可直接上传、删除、编辑发布说明
  - 固定发布（stable）支持独立管理面板（上传/删除）
- 上传链路
  - 服务端上传改为流式写盘，支持更大文件并降低内存峰值
  - 请求体限制由 256MB 调整为 2GB
  - 前端上传支持进度百分比显示与 413 超限提示
- 测试覆盖
  - 新增 `config`、`storage`、`build`、`api` 模块单元测试
  - 当前 `cargo test` 全量通过

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
