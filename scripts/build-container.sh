#!/bin/bash
# 将工程打包为 Docker 容器镜像
set -e
cd "$(dirname "$0")/.."

NAME="${1:-image-dist}"
TAG="${2:-latest}"

docker build -t "${NAME}:${TAG}" .
echo "镜像已构建: ${NAME}:${TAG}"
echo "运行: docker run -p 3000:3000 -v \$(pwd)/uploads:/app/uploads ${NAME}:${TAG}"
