import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

const client = fs.readFileSync(new URL('../src/utils/playback_metrics.js', import.meta.url), 'utf8')
const video = fs.readFileSync(new URL('../src/interaction/player/video.js', import.meta.url), 'utf8')
const loading = fs.readFileSync(new URL('../src/interaction/loading.js', import.meta.url), 'utf8')
const nginx = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')
const serverPath = fileURLToPath(new URL('../metrics/server.js', import.meta.url))
const require = createRequire(import.meta.url)
const {normalizePlayback} = require(serverPath)

describe('playback diagnostics', ()=>{
    it('uses passive Lampa and player events without patching browser requests', ()=>{
        expect(client).toContain("Lampa.Listener.follow('request_before'")
        expect(client).toContain("Lampa.Player.listener.follow('create'")
        expect(client).toContain("Lampa.PlayerVideo.listener.follow('astronaut:waiting'")
        expect(client).not.toContain('window.fetch =')
        expect(client).not.toContain('XMLHttpRequest.prototype')
        expect(video).toContain("listener.send('astronaut:loadedmetadata'")
        expect(loading).toContain("Lampa.Listener.send('astronaut:loading'")
    })

    it('exposes same-origin playback collection endpoints', ()=>{
        expect(nginx).toContain('location = /metrics/playback {')
        expect(nginx).toContain('location = /metrics/playback/history {')
        expect(nginx).toContain('limit_except GET DELETE')
    })

    it('keeps only allow-listed diagnostic fields', ()=>{
        let report = {
            schema_version: 1,
            report_type: 'playback',
            captured_at: new Date().toISOString(),
            attempt_id: 'test-attempt',
            phase: 'player',
            outcome: 'timeout',
            app: {version: '3.2.8'},
            device: {platform: 'apple', user_agent: 'test'},
            content: {id_hash: 'abc', media_type: 'tv'},
            stream: {host: 'cdn.example', type: 'hls', provider: 'mods'},
            timings: {playing_ms: 30000},
            events: {waiting_count: 1, waiting_ms: 5000, stalled_count: 1},
            requests: [{host: 'api.example', duration_ms: 30000, outcome: 'pending', status: 0}],
            secret_url: 'https://cdn.example/video.m3u8?token=secret'
        }

        let normalized = normalizePlayback(report)

        expect(normalized.outcome).toBe('timeout')
        expect(normalized.timings.playing_ms).toBe(30000)
        expect(normalized.requests[0].host).toBe('api.example')
        expect(normalized).not.toHaveProperty('secret_url')
        expect(JSON.stringify(normalized)).not.toContain('token=secret')
    })
})
