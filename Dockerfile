# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG BUILD_REVISION=local
ENV BUILD_REVISION=$BUILD_REVISION

RUN npm test -- --run && npm run build


FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

ARG BUILD_REVISION=local

LABEL org.opencontainers.image.title="Astronaut Lampa" \
      org.opencontainers.image.revision="$BUILD_REVISION" \
      org.opencontainers.image.source="https://github.com/astronaut808/lampa-source"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build/web/ /usr/share/nginx/html/

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
