# 构建阶段
FROM rust:1-bookworm AS builder

WORKDIR /app
COPY Cargo.toml ./
RUN cargo generate-lockfile 2>/dev/null || true
COPY src ./src
COPY frontend ./frontend

RUN cargo build --release

# 运行阶段
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/image-dist ./
COPY frontend ./frontend
COPY config.toml ./
RUN mkdir -p uploads

EXPOSE 3000
CMD ["./image-dist"]
