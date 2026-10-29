#!/bin/sh
set -eu

# Reuse an explicitly provided disposable instance in CI; never attach to a user's server implicitly.
if [ -n "${LAMPA_TEST_URL:-}" ]; then
    exec npm run test:browser
fi

project="lampa-browser-check-$$"
export LAMPA_BIND_ADDRESS=127.0.0.1 LAMPA_PORT=18090 IMAGE_TAG=browser-check
export BUILD_REVISION=browser-check SYNTHETIC_MONITORING_ENABLED=false

cleanup() {
    # This per-run project owns only disposable test reports.
    docker compose -p "$project" -f deploy/compose.yaml down --volumes
}
trap cleanup EXIT
docker compose -p "$project" -f deploy/compose.yaml up -d --build --wait --wait-timeout 60
LAMPA_TEST_URL=http://127.0.0.1:18090 npm run test:browser
