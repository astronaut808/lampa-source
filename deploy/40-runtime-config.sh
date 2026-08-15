#!/bin/sh

set -eu

runtime_config_path="${LAMPA_RUNTIME_CONFIG_PATH:-/tmp/runtime-config.js}"

as_boolean() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

cub_telemetry_enabled="$(as_boolean "${LAMPA_CUB_TELEMETRY_ENABLED:-false}")"
builtin_ads_enabled="$(as_boolean "${LAMPA_BUILTIN_ADS_ENABLED:-false}")"
shots_enabled="$(as_boolean "${LAMPA_SHOTS_ENABLED:-false}")"
playback_metrics_enabled="$(as_boolean "${LAMPA_PLAYBACK_METRICS_ENABLED:-true}")"
card_metrics_enabled="$(as_boolean "${LAMPA_CARD_METRICS_ENABLED:-true}")"
network_metrics_enabled="$(as_boolean "${LAMPA_NETWORK_METRICS_ENABLED:-true}")"

{
    printf 'window.LampaRuntimeConfig = Object.freeze({\n'
    printf '    cubTelemetryEnabled: %s,\n' "$cub_telemetry_enabled"
    printf '    builtinAdsEnabled: %s,\n' "$builtin_ads_enabled"
    printf '    shotsEnabled: %s,\n' "$shots_enabled"
    printf '    playbackMetricsEnabled: %s,\n' "$playback_metrics_enabled"
    printf '    cardMetricsEnabled: %s,\n' "$card_metrics_enabled"
    printf '    networkMetricsEnabled: %s\n' "$network_metrics_enabled"
    printf '})\n'
} > "$runtime_config_path"
