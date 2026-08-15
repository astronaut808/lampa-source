import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const libs = fs.readFileSync(new URL('../src/services/libs.js', import.meta.url), 'utf8')
const nginx = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const runtimeScript = fileURLToPath(new URL('../deploy/40-runtime-config.sh', import.meta.url))
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
const tmdb = fs.readFileSync(new URL('../src/core/api/sources/tmdb.js', import.meta.url), 'utf8')
const cub = fs.readFileSync(new URL('../src/core/api/sources/cub.js', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/components/main.js', import.meta.url), 'utf8')
const startupMetrics = fs.readFileSync(new URL('../src/utils/startup_metrics.js', import.meta.url), 'utf8')
const metricsServer = fs.readFileSync(new URL('../metrics/server.js', import.meta.url), 'utf8')

function generateRuntimeConfig(environment = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-runtime-'))
    const output = path.join(directory, 'runtime-config.js')
    const result = spawnSync('sh', [runtimeScript], {
        env: {
            ...process.env,
            LAMPA_RUNTIME_CONFIG_PATH: output,
            ...environment
        }
    })

    expect(result.status).toBe(0)

    const config = fs.readFileSync(output, 'utf8')
    fs.rmSync(directory, {recursive: true})

    return config
}

describe('safe startup profile', () => {
    it('keeps playback libraries eager', () => {
        expect(libs).toContain("['hls/hls.js', 'dash/dash.js', 'qrcode/qrcode.js']")
    })

    it('loads Shots only when runtime configuration enables it', () => {
        expect(libs).toContain('CustomConfig.shotsEnabled')
        expect(libs).toContain('/plugin/shots')
    })

    it('keeps the legacy YouTube API for extension compatibility', () => {
        expect(index).toContain('www.youtube.com/iframe_api')
    })

    it('enables gzip for text assets', () => {
        expect(nginx).toContain('gzip on;')
        expect(nginx).toContain('application/javascript')
    })

    it('disables optional runtime features by default', () => {
        const config = generateRuntimeConfig()

        expect(config).toContain('cubTelemetryEnabled: false')
        expect(config).toContain('builtinAdsEnabled: false')
        expect(config).toContain('shotsEnabled: false')
        expect(config).toContain('playbackMetricsEnabled: true')
        expect(config).toContain('cardMetricsEnabled: true')
        expect(config).toContain('networkMetricsEnabled: true')
        expect(config).toContain('progressiveCardEnabled: true')
        expect(config).toContain('fastStartupEnabled: true')
    })

    it('can restore optional runtime features without rebuilding', () => {
        const config = generateRuntimeConfig({
            LAMPA_CUB_TELEMETRY_ENABLED: 'true',
            LAMPA_BUILTIN_ADS_ENABLED: '1',
            LAMPA_SHOTS_ENABLED: 'on',
            LAMPA_PLAYBACK_METRICS_ENABLED: 'false',
            LAMPA_CARD_METRICS_ENABLED: 'false',
            LAMPA_NETWORK_METRICS_ENABLED: 'false',
            LAMPA_PROGRESSIVE_CARD_ENABLED: 'false',
            LAMPA_FAST_STARTUP_ENABLED: 'false'
        })

        expect(config).toContain('cubTelemetryEnabled: true')
        expect(config).toContain('builtinAdsEnabled: true')
        expect(config).toContain('shotsEnabled: true')
        expect(config).toContain('playbackMetricsEnabled: false')
        expect(config).toContain('cardMetricsEnabled: false')
        expect(config).toContain('networkMetricsEnabled: false')
        expect(config).toContain('progressiveCardEnabled: false')
        expect(config).toContain('fastStartupEnabled: false')
    })

    it('removes artificial startup waits and limits the first catalog batch', ()=>{
        expect(app).toContain('if(CustomConfig.fastStartupEnabled) loadLang()')
        expect(app).toContain('if(CustomConfig.fastStartupEnabled) reveal()')
        expect(tmdb).toContain('CustomConfig.fastStartupEnabled ? 3 : 6')
        expect(cub).toContain('CustomConfig.fastStartupEnabled ? 3 : 6')
    })

    it('measures when the first catalog rows are actually rendered', ()=>{
        expect(main).toContain('StartupMetrics.catalogReady()')
        expect(startupMetrics).toContain("name: 'Catalog ready'")
        expect(startupMetrics).toContain('catalog_ready_ms:')
        expect(metricsServer).toContain("startupHistory.findIndex(item=>item.attempt_id === report.attempt_id)")
    })
})
