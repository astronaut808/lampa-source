import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

const client = fs.readFileSync(new URL('../src/utils/card_metrics.js', import.meta.url), 'utf8')
const full = fs.readFileSync(new URL('../src/components/full.js', import.meta.url), 'utf8')
const tmdb = fs.readFileSync(new URL('../src/core/api/sources/tmdb.js', import.meta.url), 'utf8')
const cub = fs.readFileSync(new URL('../src/core/api/sources/cub.js', import.meta.url), 'utf8')
const nginx = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')
const serverPath = fileURLToPath(new URL('../metrics/server.js', import.meta.url))
const require = createRequire(import.meta.url)
const {normalizeCard} = require(serverPath)

describe('card diagnostics', ()=>{
    it('finishes a full card immediately when its primary details request fails', ()=>{
        let failure = /status\.append\('movie', json\)[\s\S]*?\},\(\)=>\{\s*status\.stop\(\)\s*onerror\(\)/

        expect(tmdb).toMatch(failure)
        expect(cub).toMatch(failure)
        expect(full).toContain("Lampa.Listener.send('astronaut:card'")
        expect(full).toContain("this.emit('error', status)")
    })

    it('observes card lifecycle and requests without replacing browser APIs', ()=>{
        expect(client).toContain("Lampa.Listener.follow('activity'")
        expect(client).toContain("Lampa.Listener.follow('full'")
        expect(client).toContain("Lampa.Listener.follow('request_before'")
        expect(client).toContain('SLOW_CARD_THRESHOLD = 15000')
        expect(client).not.toContain('window.fetch =')
        expect(client).not.toContain('XMLHttpRequest.prototype')
    })

    it('exposes same-origin card endpoints', ()=>{
        expect(nginx).toContain('location = /metrics/card {')
        expect(nginx).toContain('location = /metrics/card/history {')
        expect(nginx).toContain('location = /metrics/card/summary {')
    })

    it('keeps only allow-listed diagnostic fields', ()=>{
        let report = {
            schema_version: 1,
            report_type: 'card',
            captured_at: new Date().toISOString(),
            attempt_id: 'card-attempt',
            outcome: 'error',
            app: {version: '3.3.0'},
            device: {platform: 'apple', user_agent: 'test'},
            content: {id_hash: 'abc', media_type: 'tv', source: 'tmdb'},
            timings: {api_ms: 10000, render_ms: 0, total_ms: 10001},
            events: {slow: false, error: 'http_404'},
            requests: [{host: 'apitmdb.cub.rip', kind: 'details', duration_ms: 10000, outcome: 'error', status: 404}],
            title: 'private title',
            url: 'https://example.test/card?id=secret'
        }

        let normalized = normalizeCard(report)

        expect(normalized.outcome).toBe('error')
        expect(normalized.events.error).toBe('http_404')
        expect(normalized.requests[0]).toEqual({
            host: 'apitmdb.cub.rip',
            kind: 'details',
            duration_ms: 10000,
            outcome: 'error',
            status: 404
        })
        expect(normalized).not.toHaveProperty('title')
        expect(normalized).not.toHaveProperty('url')
        expect(JSON.stringify(normalized)).not.toContain('secret')
    })
})
