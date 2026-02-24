#!/bin/bash
# 示例构建脚本 - 将产物放入 output 目录，系统会自动上传
set -e
echo "Build started at $(date)"
mkdir -p output
echo "sample build content" > output/sample.txt
