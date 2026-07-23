#!/usr/bin/env node

'use strict'

const http = require('http')
const fs = require('fs').promises
const path = require('path')

const PORT = Number(process.env.METRICS_PORT || 9100)
const DATA_DIR = process.env.METRICS_DATA_DIR || '/data'
const STARTUP_DATA_FILE = path.join(DATA_DIR, 'startup-history.json')
const PLAYBACK_DATA_FILE = path.join(DATA_DIR, 'playback-history.json')
const STARTUP_HISTORY_LIMIT = 20
const PLAYBACK_HISTORY_LIMIT = 500
const BODY_LIMIT = 64 * 1024

let startupHistory = []
let playbackHistory = []
let startupPersistQueue = Promise.resolve()
let playbackPersistQueue = Promise.resolve()
let ready

function loadHistory(file, limit){
    return fs.readFile(file, 'utf8').then(data=>{
        let parsed = JSON.parse(data)

        return Array.isArray(parsed) ? parsed.slice(-limit) : []
    }).catch(error=>{
        if(error.code !== 'ENOENT') console.warn('Failed to load metrics history:', error.message)

        return []
    })
}

function initialize(){
    if(!ready){
        ready = fs.mkdir(DATA_DIR, {recursive: true}).then(async ()=>{
            let histories = await Promise.all([
                loadHistory(STARTUP_DATA_FILE, STARTUP_HISTORY_LIMIT),
                loadHistory(PLAYBACK_DATA_FILE, PLAYBACK_HISTORY_LIMIT)
            ])

            startupHistory = histories[0]
            playbackHistory = histories[1]
        })
    }

    return ready
}

function respond(response, status, data){
    let body = JSON.stringify(data, null, 2) + '\n'

    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    })
    response.end(body)
}

function persistStartup(){
    startupPersistQueue = startupPersistQueue.then(async ()=>{
        let temporary = STARTUP_DATA_FILE + '.tmp'

        await fs.writeFile(temporary, JSON.stringify(startupHistory, null, 2) + '\n', 'utf8')
        await fs.rename(temporary, STARTUP_DATA_FILE)
    }).catch(error=>{
        console.error('Failed to persist startup metrics:', error.message)
    })
}

function persistPlayback(){
    playbackPersistQueue = playbackPersistQueue.then(async ()=>{
        let temporary = PLAYBACK_DATA_FILE + '.tmp'

        await fs.writeFile(temporary, JSON.stringify(playbackHistory, null, 2) + '\n', 'utf8')
        await fs.rename(temporary, PLAYBACK_DATA_FILE)
    }).catch(error=>{
        console.error('Failed to persist playback metrics:', error.message)
    })
}

function text(value, limit){
    return typeof value === 'string' ? value.slice(0, limit) : ''
}

function number(value, maximum = 24 * 60 * 60 * 1000){
    value = Number(value)

    return Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0
}

function normalizeNumbers(values, keys){
    let result = {}

    values = values && typeof values === 'object' ? values : {}
    keys.forEach(key=>{
        result[key] = number(values[key])
    })

    return result
}

function normalizePlayback(report){
    if(
        !report ||
        typeof report !== 'object' ||
        report.schema_version !== 1 ||
        report.report_type !== 'playback' ||
        typeof report.attempt_id !== 'string' ||
        !report.attempt_id
    ){
        return null
    }

    let app = report.app && typeof report.app === 'object' ? report.app : {}
    let device = report.device && typeof report.device === 'object' ? report.device : {}
    let content = report.content && typeof report.content === 'object' ? report.content : {}
    let stream = report.stream && typeof report.stream === 'object' ? report.stream : {}
    let events = report.events && typeof report.events === 'object' ? report.events : {}
    let requests = Array.isArray(report.requests) ? report.requests : []

    return {
        schema_version: 1,
        report_type: 'playback',
        captured_at: text(report.captured_at, 40),
        attempt_id: text(report.attempt_id, 80),
        phase: text(report.phase, 30),
        outcome: text(report.outcome, 40),
        app: {
            version: text(app.version, 30)
        },
        device: {
            platform: text(device.platform, 40),
            user_agent: text(device.user_agent, 300)
        },
        content: {
            id_hash: text(content.id_hash, 80),
            media_type: text(content.media_type, 30)
        },
        stream: {
            host: text(stream.host, 120),
            type: text(stream.type, 30),
            provider: text(stream.provider, 80)
        },
        timings: normalizeNumbers(report.timings, [
            'loading_ms',
            'stopped_ms',
            'resolver_ms',
            'create_ms',
            'start_ms',
            'ready_ms',
            'loadstart_ms',
            'loadedmetadata_ms',
            'canplay_ms',
            'playing_ms'
        ]),
        events: {
            waiting_count: number(events.waiting_count, 100000),
            waiting_ms: number(events.waiting_ms),
            stalled_count: number(events.stalled_count, 100000),
            error: text(events.error, 240),
            fatal: Boolean(events.fatal)
        },
        requests: requests.slice(-30).map(item=>({
            host: text(item && item.host, 120),
            duration_ms: number(item && item.duration_ms),
            outcome: text(item && item.outcome, 20),
            status: number(item && item.status, 999)
        }))
    }
}

function storeStartup(report){
    report.received_at = new Date().toISOString()
    startupHistory.push(report)
    startupHistory = startupHistory.slice(-STARTUP_HISTORY_LIMIT)
    persistStartup()

    return startupHistory.length
}

function storePlayback(report){
    let now = new Date().toISOString()
    let index = playbackHistory.findIndex(item=>item.attempt_id === report.attempt_id)

    if(index >= 0){
        report.received_at = playbackHistory[index].received_at
        report.updated_at = now
        playbackHistory[index] = report
    }
    else{
        report.received_at = now
        report.updated_at = now
        playbackHistory.push(report)
    }

    playbackHistory = playbackHistory.slice(-PLAYBACK_HISTORY_LIMIT)
    persistPlayback()

    return playbackHistory.length
}

function collect(request, response, normalize, store){
    let size = 0
    let chunks = []
    let tooLarge = false

    request.on('data', chunk=>{
        size += chunk.length

        if(size > BODY_LIMIT){
            tooLarge = true
            chunks = []
            return
        }

        chunks.push(chunk)
    })

    request.on('end', ()=>{
        if(tooLarge) return respond(response, 413, {error: 'payload_too_large'})

        try{
            let report = normalize(JSON.parse(Buffer.concat(chunks).toString('utf8')))

            if(!report) return respond(response, 400, {error: 'invalid_report'})

            respond(response, 202, {stored: true, reports: store(report)})
        }
        catch(error){
            respond(response, 400, {error: 'invalid_json'})
        }
    })
}

function createServer(){
    return http.createServer(async (request, response)=>{
        await initialize()

        let pathname = new URL(request.url, 'http://metrics.local').pathname

        if(request.method === 'GET' && pathname === '/health') return respond(response, 200, {status: 'ok'})
        if(request.method === 'GET' && pathname === '/metrics'){
            return respond(response, 200, startupHistory.length ? startupHistory[startupHistory.length - 1] : {status: 'waiting_for_first_report'})
        }
        if(request.method === 'GET' && pathname === '/metrics/history') return respond(response, 200, startupHistory)
        if(request.method === 'POST' && pathname === '/metrics/startup'){
            return collect(
                request,
                response,
                report=>report && typeof report === 'object' && report.schema_version === 1 ? report : null,
                storeStartup
            )
        }
        if(request.method === 'GET' && pathname === '/metrics/playback'){
            return respond(response, 200, playbackHistory.length ? playbackHistory[playbackHistory.length - 1] : {status: 'waiting_for_first_report'})
        }
        if(request.method === 'GET' && pathname === '/metrics/playback/history') return respond(response, 200, playbackHistory)
        if(request.method === 'DELETE' && pathname === '/metrics/playback/history'){
            let cleared = playbackHistory.length

            playbackHistory = []
            persistPlayback()

            return respond(response, 200, {cleared: cleared})
        }
        if(request.method === 'POST' && pathname === '/metrics/playback'){
            return collect(request, response, normalizePlayback, storePlayback)
        }

        respond(response, 404, {error: 'not_found'})
    })
}

function start(){
    let server = createServer()
    let shutdown = ()=>server.close(()=>process.exit(0))

    initialize()

    server.listen(PORT, '0.0.0.0', ()=>{
        console.log(`Metrics collector listening on port ${PORT}`)
    })

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    return server
}

if(require.main === module) start()

module.exports = {
    createServer,
    normalizePlayback
}
