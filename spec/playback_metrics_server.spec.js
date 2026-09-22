import {describe, expect, it} from 'vitest'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

const serverPath = fileURLToPath(new URL('../metrics/server.js', import.meta.url))
const require = createRequire(import.meta.url)
const {
    filterPlaybackReports,
    mergePlaybackReport,
    normalizePlayback
} = require(serverPath)

function report(overrides){
    return Object.assign({
        schema_version: 1,
        report_type: 'playback',
        captured_at: '2026-09-20T16:22:00.000Z',
        attempt_id: 'attempt-1',
        phase: 'player',
        outcome: 'playing',
        app: {version: '3.3.4'},
        device: {platform: 'noname', user_agent: 'Hisense VIDAA Odin'},
        content: {id_hash: 'content', media_type: 'movie'},
        stream: {
            host: '192.168.1.101:9118',
            type: 'hls',
            provider: 'lampac',
            quality: '1080p',
            translation: 'voice',
            source_hash: 'abc123',
            engine: 'native_hls'
        },
        timings: {},
        events: {},
        diagnostics: {
            checkpoints: [],
            control_events: [],
            recent_samples: [],
            stalls: [],
            frame_freezes: []
        },
        requests: []
    }, overrides || {})
}

describe('playback metrics server contract', ()=>{
    it('keeps diagnostic allow-list fields and strips raw URLs', ()=>{
        let input = report({
            stream: Object.assign({}, report().stream, {secret_url: 'https://example.test/video?token=secret'}),
            diagnostics: {
                checkpoints: [{at_ms: 30000, interval_ms: 29000, media_time_ms: 40000, media_advance_ms: 29000}],
                control_events: [{at_ms: 20, category: 'command', name: 'load', reason: 'source', secret_url: 'https://example.test/?token=secret'}],
                recent_samples: [{at_ms: 1000, presentation_supported: true, presented_frames: 25}],
                stalls: [],
                frame_freezes: [],
                hls: {fragment_loaded_count: 4, last_fragment_bytes: 1024}
            }
        })
        let normalized = normalizePlayback(input)

        expect(normalized.stream.engine).toBe('native_hls')
        expect(normalized.stream.source_hash).toBe('abc123')
        expect(normalized.diagnostics.checkpoints[0].media_advance_ms).toBe(29000)
        expect(normalized.diagnostics.control_events[0].name).toBe('load')
        expect(normalized.diagnostics.recent_samples[0].presented_frames).toBe(25)
        expect(normalized.diagnostics.hls.fragment_loaded_count).toBe(4)
        expect(JSON.stringify(normalized)).not.toContain('token=secret')
    })

    it('merges heartbeat checkpoints by attempt while keeping a bounded timeline', ()=>{
        let previous = normalizePlayback(report({
            diagnostics: Object.assign({}, report().diagnostics, {
                checkpoints: Array.from({length: 120}, (_, index)=>({at_ms: index * 30000}))
            })
        }))
        let current = normalizePlayback(report({
            diagnostics: Object.assign({}, report().diagnostics, {
                checkpoints: [{at_ms: 120 * 30000, media_time_ms: 4000000}]
            })
        }))
        let merged = mergePlaybackReport(previous, current)

        expect(merged.diagnostics.checkpoints).toHaveLength(120)
        expect(merged.diagnostics.checkpoints[0].at_ms).toBe(30000)
        expect(merged.diagnostics.checkpoints.at(-1).media_time_ms).toBe(4000000)
    })

    it('filters summaries by device, engine, host, source and time', ()=>{
        let reports = [
            normalizePlayback(report()),
            normalizePlayback(report({
                captured_at: '2026-09-20T17:22:00.000Z',
                attempt_id: 'attempt-2',
                device: {platform: 'apple', user_agent: 'Safari Macintosh'},
                stream: Object.assign({}, report().stream, {engine: 'hls.js', source_hash: 'other'})
            }))
        ]

        expect(filterPlaybackReports(reports, {device: 'vidaa'})).toHaveLength(1)
        expect(filterPlaybackReports(reports, {engine: 'hls.js'})).toHaveLength(1)
        expect(filterPlaybackReports(reports, {host: '192.168.1.101:9118'})).toHaveLength(2)
        expect(filterPlaybackReports(reports, {source_hash: 'abc123'})).toHaveLength(1)
        expect(filterPlaybackReports(reports, {since: '2026-09-20T17:00:00.000Z'})).toHaveLength(1)
    })
})
