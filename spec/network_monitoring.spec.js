import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

const client = fs.readFileSync(new URL('../src/utils/network_metrics.js', import.meta.url), 'utf8')
const request = fs.readFileSync(new URL('../src/utils/reguest.js', import.meta.url), 'utf8')
const nginx = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')
const serverPath = fileURLToPath(new URL('../metrics/server.js', import.meta.url))
const syntheticPath = fileURLToPath(new URL('../metrics/synthetic.js', import.meta.url))
const require = createRequire(import.meta.url)
const {normalizeNetworkBatch} = require(serverPath)
const {addressScope, parseTargets} = require(syntheticPath)

describe('network and synthetic monitoring', ()=>{
    it('observes request results, statuses and retries without patching browser APIs', ()=>{
        expect(request).toContain("Lampa.Listener.send('request_retry'")
        expect(request).toContain('status: response_status')
        expect(client).toContain("Lampa.Listener.follow('request_before'")
        expect(client).toContain("Lampa.Listener.follow('request_retry'")
        expect(client).toContain("Lampa.Listener.follow('request_error'")
        expect(client).toContain("outcome: 'pending'")
        expect(client).toContain('PENDING_THRESHOLD = 35000')
        expect(client).not.toContain('window.fetch =')
        expect(client).not.toContain('XMLHttpRequest.prototype')
    })

    it('removes URLs, query data, payloads and identities at the collector boundary', ()=>{
        let normalized = normalizeNetworkBatch({
            schema_version: 1,
            report_type: 'network_batch',
            captured_at: '2026-08-15T00:00:00.000Z',
            app: {version: '3.3.0'},
            device: {platform: 'apple', user_agent: 'test'},
            events: [{
                request_id: 'request-1',
                occurred_at: '2026-08-15T00:00:00.000Z',
                host: 'apitmdb.cub.rip',
                route_hash: 'a1b2c3',
                kind: 'details',
                method: 'GET',
                context: 'full',
                outcome: 'error',
                status: 404,
                error_kind: 'not_found',
                duration_ms: 10000,
                retries: 1,
                online: true,
                url: 'https://apitmdb.cub.rip/3/tv/1?email=private@example.test&token=secret',
                headers: {authorization: 'secret'},
                body: {email: 'private@example.test'}
            }]
        })

        expect(normalized).toHaveLength(1)
        expect(normalized[0].status).toBe(404)
        expect(normalized[0].error_kind).toBe('not_found')
        expect(normalized[0].retries).toBe(1)
        expect(normalized[0].route_hash).toBe('a1b2c3')
        expect(normalized[0].online).toBe(true)
        expect(normalized[0]).not.toHaveProperty('url')
        expect(normalized[0]).not.toHaveProperty('headers')
        expect(normalized[0]).not.toHaveProperty('body')
        expect(JSON.stringify(normalized)).not.toContain('private@example.test')
        expect(JSON.stringify(normalized)).not.toContain('secret')
    })

    it('detects loopback and private DNS answers without storing addresses', ()=>{
        expect(addressScope('127.0.0.1')).toBe('loopback')
        expect(addressScope('::ffff:127.0.0.1')).toBe('loopback')
        expect(addressScope('192.168.1.101')).toBe('private')
        expect(addressScope('104.21.69.116')).toBe('public')
        expect(parseTargets('tmdb=image.tmdb.org', '')).toEqual([{name: 'tmdb', target: 'image.tmdb.org'}])
    })

    it('exposes liveness, readiness, dependency and monitoring endpoints', ()=>{
        expect(nginx).toContain('location = /readyz {')
        expect(nginx).toContain('location = /health/dependencies {')
        expect(nginx).toContain('location = /metrics/network/history {')
        expect(nginx).toContain('location = /metrics/network/summary {')
        expect(nginx).toContain('location = /metrics/synthetic/run {')
    })
})
