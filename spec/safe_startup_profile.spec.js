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
    })

    it('can restore optional runtime features without rebuilding', () => {
        const config = generateRuntimeConfig({
            LAMPA_CUB_TELEMETRY_ENABLED: 'true',
            LAMPA_BUILTIN_ADS_ENABLED: '1',
            LAMPA_SHOTS_ENABLED: 'on'
        })

        expect(config).toContain('cubTelemetryEnabled: true')
        expect(config).toContain('builtinAdsEnabled: true')
        expect(config).toContain('shotsEnabled: true')
    })
})
