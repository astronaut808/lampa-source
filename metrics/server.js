#!/usr/bin/env node

'use strict'

const http = require('http')
const fs = require('fs').promises
const path = require('path')
const {createSyntheticMonitor} = require('./synthetic')

const PORT = Number(process.env.METRICS_PORT || 9100)
const DATA_DIR = process.env.METRICS_DATA_DIR || '/data'
const STARTUP_DATA_FILE = path.join(DATA_DIR, 'startup-history.json')
const PLAYBACK_DATA_FILE = path.join(DATA_DIR, 'playback-history.json')
const CARD_DATA_FILE = path.join(DATA_DIR, 'card-history.json')
const NETWORK_DATA_FILE = path.join(DATA_DIR, 'network-history.json')
const SYNTHETIC_DATA_FILE = path.join(DATA_DIR, 'synthetic-history.json')
const STARTUP_HISTORY_LIMIT = 20
const PLAYBACK_HISTORY_LIMIT = 500
const CARD_HISTORY_LIMIT = 500
const NETWORK_HISTORY_LIMIT = 2000
const SYNTHETIC_HISTORY_LIMIT = 1440
const BODY_LIMIT = 64 * 1024

let startupHistory = []
let playbackHistory = []
let cardHistory = []
let networkHistory = []
let syntheticHistory = []
let startupPersistQueue = Promise.resolve()
let playbackPersistQueue = Promise.resolve()
let cardPersistQueue = Promise.resolve()
let networkPersistQueue = Promise.resolve()
let syntheticPersistQueue = Promise.resolve()
let ready
let syntheticMonitor = null

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
                loadHistory(PLAYBACK_DATA_FILE, PLAYBACK_HISTORY_LIMIT),
                loadHistory(CARD_DATA_FILE, CARD_HISTORY_LIMIT),
                loadHistory(NETWORK_DATA_FILE, NETWORK_HISTORY_LIMIT),
                loadHistory(SYNTHETIC_DATA_FILE, SYNTHETIC_HISTORY_LIMIT)
            ])

            startupHistory = histories[0]
            playbackHistory = histories[1]
            cardHistory = histories[2]
            networkHistory = histories[3]
            syntheticHistory = histories[4]
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

function persistCard(){
    cardPersistQueue = cardPersistQueue.then(async ()=>{
        let temporary = CARD_DATA_FILE + '.tmp'

        await fs.writeFile(temporary, JSON.stringify(cardHistory, null, 2) + '\n', 'utf8')
        await fs.rename(temporary, CARD_DATA_FILE)
    }).catch(error=>{
        console.error('Failed to persist card metrics:', error.message)
    })
}

function persistNetwork(){
    networkPersistQueue = networkPersistQueue.then(async ()=>{
        let temporary = NETWORK_DATA_FILE + '.tmp'

        await fs.writeFile(temporary, JSON.stringify(networkHistory, null, 2) + '\n', 'utf8')
        await fs.rename(temporary, NETWORK_DATA_FILE)
    }).catch(error=>{
        console.error('Failed to persist network metrics:', error.message)
    })
}

function persistSynthetic(){
    syntheticPersistQueue = syntheticPersistQueue.then(async ()=>{
        let temporary = SYNTHETIC_DATA_FILE + '.tmp'

        await fs.writeFile(temporary, JSON.stringify(syntheticHistory, null, 2) + '\n', 'utf8')
        await fs.rename(temporary, SYNTHETIC_DATA_FILE)
    }).catch(error=>{
        console.error('Failed to persist synthetic metrics:', error.message)
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

function choice(value, allowed, fallback = ''){
    return allowed.includes(value) ? value : fallback
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

function normalizeCard(report){
    if(
        !report ||
        typeof report !== 'object' ||
        report.schema_version !== 1 ||
        report.report_type !== 'card' ||
        typeof report.attempt_id !== 'string' ||
        !report.attempt_id
    ){
        return null
    }

    let app = report.app && typeof report.app === 'object' ? report.app : {}
    let device = report.device && typeof report.device === 'object' ? report.device : {}
    let content = report.content && typeof report.content === 'object' ? report.content : {}
    let events = report.events && typeof report.events === 'object' ? report.events : {}
    let requests = Array.isArray(report.requests) ? report.requests : []

    return {
        schema_version: 1,
        report_type: 'card',
        captured_at: text(report.captured_at, 40),
        attempt_id: text(report.attempt_id, 80),
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
            media_type: text(content.media_type, 30),
            source: text(content.source, 30)
        },
        timings: normalizeNumbers(report.timings, [
            'api_ms',
            'render_ms',
            'total_ms'
        ]),
        events: {
            slow: Boolean(events.slow),
            error: text(events.error, 80)
        },
        requests: requests.slice(-40).map(item=>({
            host: text(item && item.host, 120),
            kind: text(item && item.kind, 30),
            duration_ms: number(item && item.duration_ms),
            outcome: text(item && item.outcome, 20),
            status: number(item && item.status, 999)
        }))
    }
}

function normalizeNetworkBatch(report){
    if(
        !report ||
        typeof report !== 'object' ||
        report.schema_version !== 1 ||
        report.report_type !== 'network_batch' ||
        !Array.isArray(report.events)
    ){
        return null
    }

    let app = report.app && typeof report.app === 'object' ? report.app : {}
    let device = report.device && typeof report.device === 'object' ? report.device : {}
    let normalizedApp = {version: text(app.version, 30)}
    let normalizedDevice = {
        platform: text(device.platform, 40),
        user_agent: text(device.user_agent, 300)
    }

    return report.events.slice(0, 50).map(event=>{
        event = event && typeof event === 'object' ? event : {}

        return {
            schema_version: 1,
            report_type: 'network',
            captured_at: text(report.captured_at, 40),
            occurred_at: text(event.occurred_at, 40),
            request_id: text(event.request_id, 80),
            app: normalizedApp,
            device: normalizedDevice,
            host: text(event.host, 120),
            route_hash: text(event.route_hash, 20),
            kind: text(event.kind, 30),
            method: choice(text(event.method, 10), ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], 'OTHER'),
            context: text(event.context, 30),
            outcome: choice(event.outcome, ['success', 'error', 'pending'], 'error'),
            status: number(event.status, 999),
            error_kind: choice(event.error_kind, [
                '',
                'timeout',
                'abort',
                'network',
                'access',
                'not_found',
                'retryable_http',
                'server',
                'client',
                'pending',
                'unknown'
            ], 'unknown'),
            duration_ms: number(event.duration_ms),
            retries: number(event.retries, 20),
            from_cache: Boolean(event.from_cache),
            online: event.online !== false
        }
    })
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

function storeCard(report){
    let now = new Date().toISOString()
    let index = cardHistory.findIndex(item=>item.attempt_id === report.attempt_id)

    if(index >= 0){
        report.received_at = cardHistory[index].received_at
        report.updated_at = now
        cardHistory[index] = report
    }
    else{
        report.received_at = now
        report.updated_at = now
        cardHistory.push(report)
    }

    cardHistory = cardHistory.slice(-CARD_HISTORY_LIMIT)
    persistCard()

    return cardHistory.length
}

function storeNetwork(events){
    let receivedAt = new Date().toISOString()

    events.forEach(event=>event.received_at = receivedAt)
    networkHistory = networkHistory.concat(events).slice(-NETWORK_HISTORY_LIMIT)
    persistNetwork()

    return networkHistory.length
}

function storeSynthetic(report){
    report.received_at = new Date().toISOString()
    syntheticHistory.push(report)
    syntheticHistory = syntheticHistory.slice(-SYNTHETIC_HISTORY_LIMIT)
    persistSynthetic()

    return syntheticHistory.length
}

function percentile(values, value){
    if(!values.length) return 0

    let index = Math.min(values.length - 1, Math.ceil(values.length * value) - 1)

    return values[index]
}

function cardSummary(){
    let durations = cardHistory.map(item=>item.timings.total_ms).filter(Boolean).sort((a,b)=>a - b)
    let totalDuration = durations.reduce((total, duration)=>total + duration, 0)

    return {
        total: cardHistory.length,
        success: cardHistory.filter(item=>item.outcome === 'success').length,
        slow: cardHistory.filter(item=>item.events.slow).length,
        errors: cardHistory.filter(item=>item.outcome === 'error').length,
        cancelled: cardHistory.filter(item=>item.outcome === 'cancelled').length,
        average_ms: durations.length ? Math.round(totalDuration / durations.length) : 0,
        p50_ms: percentile(durations, 0.5),
        p95_ms: percentile(durations, 0.95)
    }
}

function networkSummary(){
    let groups = new Map()

    networkHistory.forEach(event=>{
        let key = (event.host || 'unknown') + '|' + (event.kind || 'other')
        let group = groups.get(key)

        if(!group){
            group = {
                host: event.host || 'unknown',
                kind: event.kind || 'other',
                total: 0,
                success: 0,
                errors: 0,
                pending: 0,
                retries: 0,
                durations: [],
                statuses: {},
                error_kinds: {},
                last_at: ''
            }
            groups.set(key, group)
        }

        group.total++
        group.success += event.outcome === 'success' ? 1 : 0
        group.errors += event.outcome === 'error' ? 1 : 0
        group.pending += event.outcome === 'pending' ? 1 : 0
        group.retries += event.retries
        group.durations.push(event.duration_ms)
        group.last_at = event.occurred_at || event.received_at

        if(event.status) group.statuses[event.status] = (group.statuses[event.status] || 0) + 1
        if(event.error_kind) group.error_kinds[event.error_kind] = (group.error_kinds[event.error_kind] || 0) + 1
    })

    return Array.from(groups.values()).map(group=>{
        let durations = group.durations.sort((a,b)=>a - b)
        let totalDuration = durations.reduce((total, duration)=>total + duration, 0)

        delete group.durations
        group.average_ms = durations.length ? Math.round(totalDuration / durations.length) : 0
        group.p95_ms = percentile(durations, 0.95)

        return group
    }).sort((a,b)=>b.errors - a.errors || b.p95_ms - a.p95_ms)
}

function latestSynthetic(){
    return syntheticHistory.length ? syntheticHistory[syntheticHistory.length - 1] : null
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

        if(request.method === 'GET' && (pathname === '/health' || pathname === '/health/live')){
            return respond(response, 200, {
                status: 'ok',
                uptime_seconds: Math.floor(process.uptime()),
                timestamp: new Date().toISOString()
            })
        }
        if(request.method === 'GET' && pathname === '/health/ready'){
            return respond(response, 200, {
                status: 'ready',
                storage: 'ok',
                timestamp: new Date().toISOString()
            })
        }
        if(request.method === 'GET' && pathname === '/health/dependencies'){
            let latest = latestSynthetic()

            if(!latest) return respond(response, 503, {status: 'waiting_for_first_check'})

            return respond(response, latest.outcome === 'ok' ? 200 : 503, latest)
        }
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
        if(request.method === 'GET' && pathname === '/metrics/card'){
            return respond(response, 200, cardHistory.length ? cardHistory[cardHistory.length - 1] : {status: 'waiting_for_first_report'})
        }
        if(request.method === 'GET' && pathname === '/metrics/card/history') return respond(response, 200, cardHistory)
        if(request.method === 'GET' && pathname === '/metrics/card/summary') return respond(response, 200, cardSummary())
        if(request.method === 'DELETE' && pathname === '/metrics/card/history'){
            let cleared = cardHistory.length

            cardHistory = []
            persistCard()

            return respond(response, 200, {cleared: cleared})
        }
        if(request.method === 'POST' && pathname === '/metrics/card'){
            return collect(request, response, normalizeCard, storeCard)
        }
        if(request.method === 'GET' && pathname === '/metrics/network'){
            return respond(response, 200, networkHistory.length ? networkHistory[networkHistory.length - 1] : {status: 'waiting_for_first_report'})
        }
        if(request.method === 'GET' && pathname === '/metrics/network/history') return respond(response, 200, networkHistory)
        if(request.method === 'GET' && pathname === '/metrics/network/summary') return respond(response, 200, networkSummary())
        if(request.method === 'DELETE' && pathname === '/metrics/network/history'){
            let cleared = networkHistory.length

            networkHistory = []
            persistNetwork()

            return respond(response, 200, {cleared})
        }
        if(request.method === 'POST' && pathname === '/metrics/network'){
            return collect(request, response, normalizeNetworkBatch, storeNetwork)
        }
        if(request.method === 'GET' && pathname === '/metrics/synthetic'){
            return respond(response, 200, latestSynthetic() || {status: 'waiting_for_first_check'})
        }
        if(request.method === 'GET' && pathname === '/metrics/synthetic/history') return respond(response, 200, syntheticHistory)
        if(request.method === 'DELETE' && pathname === '/metrics/synthetic/history'){
            let cleared = syntheticHistory.length

            syntheticHistory = []
            persistSynthetic()

            return respond(response, 200, {cleared})
        }
        if(request.method === 'POST' && pathname === '/metrics/synthetic/run'){
            if(!syntheticMonitor?.enabled) return respond(response, 503, {error: 'synthetic_monitoring_disabled'})

            let result = await syntheticMonitor.run()

            return respond(response, 200, result)
        }

        respond(response, 404, {error: 'not_found'})
    })
}

function start(){
    let server = createServer()
    let shutdown = ()=>{
        syntheticMonitor?.stop()
        server.close(()=>process.exit(0))
    }

    syntheticMonitor = createSyntheticMonitor({
        enabled: process.env.SYNTHETIC_MONITORING_ENABLED !== 'false',
        interval: process.env.SYNTHETIC_INTERVAL_MS,
        timeout: process.env.SYNTHETIC_TIMEOUT_MS,
        dnsTargets: process.env.SYNTHETIC_DNS_TARGETS,
        httpTargets: process.env.SYNTHETIC_HTTP_TARGETS,
        onResult: storeSynthetic
    })

    initialize().then(()=>syntheticMonitor.start())

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
    normalizePlayback,
    normalizeCard,
    normalizeNetworkBatch,
    networkSummary
}
