#!/bin/sh
set -eu

# Local-only sandbox: different Compose project, port, images and metrics volume.
project=lampa-346-test
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
export LAMPA_BIND_ADDRESS=127.0.0.1 LAMPA_PORT=18096
export IMAGE_TAG=upstream-3.4.6-test SYNTHETIC_MONITORING_ENABLED=false
export BUILD_REVISION=experiment-upstream-3.4.6-86c2b099-worktree

case "${1:-up}" in
    up)
        docker compose -p "$project" -f deploy/compose.yaml up -d --build --wait --wait-timeout 90
        printf '\nExperimental Lampa: http://localhost:18096/\n'
        ;;
    test)
        LAMPA_TEST_URL=http://127.0.0.1:18096 npm run test:browser
        ;;
    down)
        # Keep the disposable metrics volume unless its removal is requested separately.
        docker compose -p "$project" -f deploy/compose.yaml down
        ;;
    *)
        printf 'Usage: sh scripts/test-experiment.sh [up|test|down]\n' >&2
        exit 2
        ;;
esac
