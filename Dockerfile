# 运行阶段
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY target/release/image-dist ./
COPY frontend ./frontend
COPY config.toml ./
RUN mkdir -p uploads

ENV FRONTEND_DIR=/app/frontend

EXPOSE 3000
CMD ["./image-dist"]
