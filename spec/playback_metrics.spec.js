import {describe, expect, it} from 'vitest'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {
    sample,
    detectIssue,
    classifyStall
} from '../src/utils/playback_observer'

const client = fs.readFileSync(new URL('../src/utils/playback_metrics.js', import.meta.url), 'utf8')
const video = fs.readFileSync(new URL('../src/interaction/player/video.js', import.meta.url), 'utf8')
const loading = fs.readFileSync(new URL('../src/interaction/loading.js', import.meta.url), 'utf8')
const nginx = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')
const serverPath = fileURLToPath(new URL('../metrics/server.js', import.meta.url))
const require = createRequire(import.meta.url)
const {normalizePlayback, summarizePlaybackReports} = require(serverPath)

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

    it('keeps Lampa 3.3 media loading and modular player contracts', ()=>{
        expect(loading).toContain('function start(on_cancel, text, options = {})')
        expect(loading).toContain('media_loader = MediaLoading.create()')
        expect(loading).toContain('setProgress')
        expect(video).toContain("import HlsStream from './video/hls'")
        expect(video).toContain("import DashStream from './video/dash'")
        expect(video).toContain('registerTube: Tube.register')
        expect(video).toContain("listener.send('astronaut:playing'")
    })

    it('exposes same-origin playback collection endpoints', ()=>{
        expect(nginx).toContain('location = /metrics/playback {')
        expect(nginx).toContain('location = /metrics/playback/history {')
        expect(nginx).toContain('location = /metrics/playback/summary {')
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
            diagnostics: {
                sample_interval_ms: 1000,
                connection: {effective_type: '4g', downlink_mbps: 42, rtt_ms: 10},
                recent_samples: [{
                    at_ms: 1000,
                    media_time_ms: 5000,
                    buffer_ahead_ms: 2500,
                    ready_state: 4,
                    network_state: 1,
                    frame_counters: true,
                    decoded_frames: 150,
                    dropped_frames: 2,
                    secret_url: 'https://cdn.example/segment.ts?token=secret'
                }],
                stalls: [{
                    sequence: 1,
                    trigger: 'waiting',
                    duration_ms: 4200,
                    recovered: true,
                    classification: 'buffer_starvation'
                }],
                frame_freezes: [{
                    sequence: 1,
                    kind: 'video_frames_not_advancing',
                    duration_ms: 3000,
                    recovered: true
                }]
            },
            requests: [{host: 'api.example', duration_ms: 30000, outcome: 'pending', status: 0}],
            secret_url: 'https://cdn.example/video.m3u8?token=secret'
        }

        let normalized = normalizePlayback(report)

        expect(normalized.outcome).toBe('timeout')
        expect(normalized.timings.playing_ms).toBe(30000)
        expect(normalized.requests[0].host).toBe('api.example')
        expect(normalized.diagnostics.stalls[0].classification).toBe('buffer_starvation')
        expect(normalized.diagnostics.frame_freezes[0].kind).toBe('video_frames_not_advancing')
        expect(normalized.diagnostics.recent_samples[0].decoded_frames).toBe(150)
        expect(normalized).not.toHaveProperty('secret_url')
        expect(JSON.stringify(normalized)).not.toContain('token=secret')
    })

    it('classifies buffer starvation from bounded media state', ()=>{
        let start = {buffer_ahead_ms: 0, ready_state: 2, frame_counters: true, decoded_frames: 10}
        let end = {buffer_ahead_ms: 3000, ready_state: 4, frame_counters: true, decoded_frames: 40}

        expect(classifyStall(start, end)).toBe('buffer_starvation')
    })

    it('detects video frames stopping while the media clock keeps moving', ()=>{
        let samples = [
            {at_ms: 0, media_time_ms: 1000, buffer_ahead_ms: 5000, ready_state: 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, frame_counters: true, decoded_frames: 100},
            {at_ms: 1000, media_time_ms: 2000, buffer_ahead_ms: 5000, ready_state: 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, frame_counters: true, decoded_frames: 100},
            {at_ms: 3000, media_time_ms: 4000, buffer_ahead_ms: 4000, ready_state: 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, frame_counters: true, decoded_frames: 100}
        ]

        expect(detectIssue(samples)).toBe('video_frames_not_advancing')
    })

    it('does not report a finished stream or a reset frame counter as a freeze', ()=>{
        let finished = [
            {at_ms: 0, media_time_ms: 1000, buffer_ahead_ms: 5000, ready_state: 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, frame_counters: true, decoded_frames: 100},
            {at_ms: 3000, media_time_ms: 4000, buffer_ahead_ms: 0, ready_state: 4, paused: false, seeking: false, ended: true, width: 1920, height: 1080, frame_counters: true, decoded_frames: 100}
        ]
        let reset = [
            {at_ms: 0, media_time_ms: 1000, buffer_ahead_ms: 5000, ready_state: 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, frame_counters: true, decoded_frames: 100},
            {at_ms: 3000, media_time_ms: 4000, buffer_ahead_ms: 5000, ready_state: 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, frame_counters: true, decoded_frames: 5}
        ]

        expect(detectIssue(finished)).toBe('')
        expect(detectIssue(reset)).toBe('')
    })

    it('reads buffer and frame counters without changing the video element', ()=>{
        let video = {
            currentTime: 10,
            readyState: 4,
            networkState: 1,
            paused: false,
            seeking: false,
            ended: false,
            videoWidth: 1920,
            videoHeight: 1080,
            buffered: {
                length: 1,
                start: ()=>0,
                end: ()=>15
            },
            getVideoPlaybackQuality: ()=>({totalVideoFrames: 300, droppedVideoFrames: 4})
        }
        let result = sample(video, 2000)

        expect(result.buffer_ahead_ms).toBe(5000)
        expect(result.decoded_frames).toBe(300)
        expect(result.dropped_frames).toBe(4)
        expect(result.width).toBe(1920)
        expect(result.ended).toBe(false)
    })

    it('sorts stall durations before calculating playback percentiles', ()=>{
        let reports = [9000, 1000, 5000, 3000].map((duration, index)=>({
            device: {user_agent: index === 0 ? 'Hisense VIDAA Odin' : 'Safari Macintosh'},
            events: {fatal: false},
            diagnostics: {
                stalls: [{duration_ms: duration, classification: 'buffer_starvation'}],
                frame_freezes: []
            }
        }))
        let summary = summarizePlaybackReports(reports)

        expect(summary.stall_duration_ms.average).toBe(4500)
        expect(summary.stall_duration_ms.p50).toBe(3000)
        expect(summary.stall_duration_ms.p95).toBe(9000)
        expect(summary.stall_duration_ms.maximum).toBe(9000)
        expect(summary.devices.vidaa.reports).toBe(1)
    })
})
