# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG BUILD_REVISION=local
ENV BUILD_REVISION=$BUILD_REVISION

RUN npm test -- --run && npm run build


FROM node:22-alpine AS metrics

WORKDIR /app

ENV NODE_ENV=production \
    METRICS_PORT=9100 \
    METRICS_DATA_DIR=/data

COPY metrics/server.js ./server.js

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 9100

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:9100/health >/dev/null || exit 1

CMD ["node", "server.js"]


FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

ARG BUILD_REVISION=local

LABEL org.opencontainers.image.title="Astronaut Lampa" \
      org.opencontainers.image.revision="$BUILD_REVISION" \
      org.opencontainers.image.source="https://github.com/astronaut808/lampa-source"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 deploy/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=builder /app/build/web/ /usr/share/nginx/html/

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
