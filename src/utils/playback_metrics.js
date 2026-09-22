import Manifest from '../core/manifest'
import CustomConfig from '../custom/config'
import {
    FRAME_WINDOW_MS,
    sample as mediaSample,
    detectIssue,
    classifyStall,
    summarizeWindow
} from './playback_observer'

const PLAYBACK_TIMEOUT = 30000
const RESOLVER_REPORT_THRESHOLD = 2000
const REQUEST_WINDOW = 30000
const REQUEST_RETENTION = 120000
const REQUEST_LIMIT = 50
const SAMPLE_INTERVAL = 1000
const SAMPLE_LIMIT = 30
const STALL_LIMIT = 20
const FRAME_FREEZE_LIMIT = 10
const STALL_REPORT_DELAY = 2000
const HEARTBEAT_INTERVAL = 30000
const CONTROL_GRACE_MS = 5000
const CONTROL_EVENT_LIMIT = 80
const CHECKPOINT_WINDOW = 30

let attempt = null
let resolver = null
let recentRequests = []
let pendingRequests = []
let sampleTimer = null
let heartbeatTimer = null
let frameObserver = null

function timestamp(){
    return Date.now()
}

function elapsed(start){
    return Math.max(0, timestamp() - start)
}

function clampText(value, limit){
    return typeof value == 'string' ? value.slice(0, limit) : ''
}

function hostFromUrl(value){
    if(typeof value !== 'string' || !value) return ''

    try{
        let link = document.createElement('a')
            link.href = value

        return clampText(link.host, 120)
    }
    catch(e){
        return ''
    }
}

function streamType(value){
    let url = typeof value == 'string' ? value.toLowerCase().split('?')[0] : ''

    if(url.indexOf('.m3u8') >= 0) return 'hls'
    if(url.indexOf('.mpd') >= 0) return 'dash'
    if(url.indexOf('.mp4') >= 0) return 'mp4'
    if(url.indexOf('youtube.com') >= 0 || url.indexOf('youtu.be') >= 0) return 'youtube'

    return 'unknown'
}

function safeLabel(value){
    if(typeof value !== 'string' || !value || value.indexOf('://') >= 0) return ''

    return value.slice(0, 80)
}

function firstSafeLabel(values){
    for(let i = 0; i < values.length; i++){
        let value = safeLabel(values[i])

        if(value) return value
    }

    return ''
}

function streamHash(value){
    if(typeof value !== 'string' || !value) return ''

    try{
        let link = document.createElement('a')
            link.href = value

        return hash((link.host || '') + (link.pathname || ''))
    }
    catch(e){
        return ''
    }
}

function hash(value){
    let result = 2166136261

    for(let i = 0; i < value.length; i++){
        result ^= value.charCodeAt(i)
        result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24)
    }

    return (result >>> 0).toString(16)
}

function activeCard(data){
    let active = null

    try{
        active = Lampa.Activity.active()
    }
    catch(e){}

    return data && data.card || active && (active.movie || active.card) || {}
}

function contentInfo(data){
    let card = activeCard(data)
    let identity = [
        card.source || '',
        card.id || '',
        card.imdb_id || '',
        card.kinopoisk_id || ''
    ].join(':')

    return {
        id_hash: identity.replace(/:/g, '') ? hash(identity) : '',
        media_type: safeLabel(card.media_type || card.method || data && data.media_type || '')
    }
}

function qualityLabel(data){
    if(!data) return ''
    if(typeof data.quality == 'string') return safeLabel(data.quality)
    if(!data.quality || typeof data.quality !== 'object') return ''

    let names = Object.keys(data.quality)

    for(let i = 0; i < names.length; i++){
        let option = data.quality[names[i]]
        let url = typeof option == 'string' ? option : option && option.url

        if(url && url == data.url) return safeLabel(names[i])
    }

    return ''
}

function streamInfo(data){
    data = data || {}

    return {
        host: hostFromUrl(data.url),
        type: streamType(data.url),
        provider: firstSafeLabel([data.balancer, data.provider, data.source, data.from]),
        quality: firstSafeLabel([data.quality_switched, data.quality_label, data.video_quality, qualityLabel(data)]),
        translation: firstSafeLabel([data.voice_name, data.translation, typeof data.translate == 'string' ? data.translate : '']),
        source_hash: streamHash(data.url),
        engine: 'unknown'
    }
}

function updateStreamInfo(current, data){
    if(!current || !data) return

    let engine = current.stream.engine
    let updated = streamInfo(data)

    updated.engine = engine || 'unknown'
    current.stream = updated
}

function requestStart(event){
    let params = event && event.params

    if(!params) return

    pendingRequests.push({
        params: params,
        started_at: timestamp(),
        host: hostFromUrl(params.url)
    })

    if(pendingRequests.length > REQUEST_LIMIT) pendingRequests.shift()
}

function requestFinish(event, outcome){
    let params = event && event.params
    let index = -1

    for(let i = pendingRequests.length - 1; i >= 0; i--){
        if(pendingRequests[i].params === params){
            index = i
            break
        }
    }

    if(index < 0) return

    let pending = pendingRequests.splice(index, 1)[0]
    let status = event && (event.error && Number(event.error.status) || Number(event.status)) || 0

    recentRequests.push({
        started_at: pending.started_at,
        host: pending.host,
        duration_ms: elapsed(pending.started_at),
        outcome: outcome,
        status: status
    })

    let cutoff = timestamp() - REQUEST_RETENTION
        recentRequests = recentRequests.filter(item=>item.started_at >= cutoff).slice(-REQUEST_LIMIT)
}

function requestsSince(startedAt){
    let from = startedAt - REQUEST_WINDOW
    let finished = recentRequests.filter(item=>item.started_at >= from).map(item=>({
        host: item.host,
        duration_ms: item.duration_ms,
        outcome: item.outcome,
        status: item.status
    }))
    let pending = pendingRequests.filter(item=>item.started_at >= from).map(item=>({
        host: item.host,
        duration_ms: elapsed(item.started_at),
        outcome: 'pending',
        status: 0
    }))

    return finished.concat(pending).slice(-30)
}

function send(report){
    let body = JSON.stringify(report)

    try{
        if(navigator.sendBeacon){
            let blob = new Blob([body], {type: 'application/json'})

            if(navigator.sendBeacon('/metrics/playback', blob)) return
        }
    }
    catch(e){}

    try{
        let request = new XMLHttpRequest()
            request.open('POST', '/metrics/playback', true)
            request.setRequestHeader('Content-Type', 'application/json')
            request.timeout = 3000
            request.send(body)
    }
    catch(e){}
}

function deviceInfo(){
    let platform = ''

    try{
        platform = Lampa.Platform.get()
    }
    catch(e){}

    return {
        platform: clampText(platform, 40),
        user_agent: clampText(navigator.userAgent || '', 300)
    }
}

function connectionInfo(){
    let browser = typeof navigator !== 'undefined' ? navigator : {}
    let connection = browser.connection || browser.mozConnection || browser.webkitConnection || {}

    return {
        effective_type: clampText(connection.effectiveType || '', 20),
        downlink_mbps: Math.max(0, Number(connection.downlink) || 0),
        rtt_ms: Math.max(0, Number(connection.rtt) || 0),
        save_data: Boolean(connection.saveData)
    }
}

function videoElement(){
    try{
        return Lampa.PlayerVideo.video()
    }
    catch(e){
        return null
    }
}

function stopFrameObserver(){
    if(frameObserver && frameObserver.schedule_timer) clearTimeout(frameObserver.schedule_timer)

    if(
        frameObserver &&
        frameObserver.video &&
        frameObserver.callback_id &&
        typeof frameObserver.video.cancelVideoFrameCallback === 'function'
    ){
        try{ frameObserver.video.cancelVideoFrameCallback(frameObserver.callback_id) }
        catch(e){}
    }

    frameObserver = null
}

function ensureFrameObserver(video, current){
    if(!video || !current) return null
    if(frameObserver && frameObserver.video === video) return frameObserver

    stopFrameObserver()

    frameObserver = {
        video: video,
        supported: typeof video.requestVideoFrameCallback === 'function',
        callback_id: 0,
        schedule_timer: null,
        frames: 0,
        last_wall_at: 0,
        media_time_ms: 0
    }

    if(!frameObserver.supported) return frameObserver

    let requestNext = ()=>{
        if(!attempt || !frameObserver || frameObserver.video !== video) return

        try{ frameObserver.callback_id = video.requestVideoFrameCallback(observe) }
        catch(e){ frameObserver.supported = false }
    }
    let observe = (now, metadata)=>{
        if(!attempt || !frameObserver || frameObserver.video !== video) return

        frameObserver.frames = Math.max(
            frameObserver.frames + 1,
            Number(metadata && metadata.presentedFrames) || 0
        )
        frameObserver.last_wall_at = timestamp()
        frameObserver.media_time_ms = Math.max(0, Math.round((Number(metadata && metadata.mediaTime) || 0) * 1000))

        frameObserver.schedule_timer = setTimeout(requestNext, 500)
    }

    requestNext()

    return frameObserver
}

function presentationInfo(current, video){
    let observer = ensureFrameObserver(video, current)

    if(!observer) return {}

    return {
        supported: observer.supported,
        frames: observer.frames,
        media_time_ms: observer.media_time_ms,
        gap_ms: observer.last_wall_at ? elapsed(observer.last_wall_at) : 0
    }
}

function snapshot(current){
    let video = videoElement()

    return video ? mediaSample(video, elapsed(current.started_at), {
        presentation: presentationInfo(current, video),
        control_active: timestamp() < (current.control_grace_until || 0),
        hidden: typeof document !== 'undefined' && Boolean(document.hidden)
    }) : null
}

function appendControlEvent(current, category, event){
    if(!current) return

    event = event || {}

    current.control_events.push({
        at_ms: elapsed(current.started_at),
        category: safeLabel(category),
        name: firstSafeLabel([event.action, event.name, event.kind, event.type]),
        reason: safeLabel(event.reason || ''),
        value_ms: Math.max(0, Math.round(Number(event.value_ms) || 0)),
        duration_ms: Math.max(0, Math.round(Number(event.duration_ms) || 0)),
        level: Math.max(0, Math.round(Number(event.level) || 0)),
        fatal: Boolean(event.fatal)
    })
    current.control_events = current.control_events.slice(-CONTROL_EVENT_LIMIT)
}

function checkpoint(current){
    let samples = (current.samples || []).slice(-CHECKPOINT_WINDOW)
    let summary = summarizeWindow(samples)

    if(summary) current.latest_checkpoint = summary
}

function diagnostics(current){
    let samples = current.samples || []
    let stalls = (current.stalls || []).slice(-STALL_LIMIT)
    let frameFreezes = (current.frame_freezes || []).slice(-FRAME_FREEZE_LIMIT)

    if(current.active_stall){
        stalls = stalls.concat([{
            sequence: current.active_stall.sequence,
            trigger: current.active_stall.trigger,
            duration_ms: elapsed(current.active_stall.started_at),
            recovered: false,
            classification: 'active',
            start: current.active_stall.start,
            end: snapshot(current)
        }]).slice(-STALL_LIMIT)
    }

    if(current.active_frame_freeze){
        frameFreezes = frameFreezes.concat([{
            sequence: current.active_frame_freeze.sequence,
            kind: current.active_frame_freeze.kind,
            duration_ms: elapsed(current.active_frame_freeze.started_at),
            recovered: false,
            start: current.active_frame_freeze.start,
            end: snapshot(current)
        }]).slice(-FRAME_FREEZE_LIMIT)
    }

    return {
        sample_interval_ms: SAMPLE_INTERVAL,
        connection: connectionInfo(),
        recent_samples: samples.slice(-SAMPLE_LIMIT),
        checkpoints: current.latest_checkpoint ? [current.latest_checkpoint] : [],
        control_events: (current.control_events || []).slice(-CONTROL_EVENT_LIMIT),
        hls: current.hls || {},
        stalls: stalls,
        frame_freezes: frameFreezes
    }
}

function report(current, outcome){
    if(!current) return

    let now = timestamp()
    let waiting = current.waiting_started ? current.waiting_ms + (now - current.waiting_started) : current.waiting_ms
    let timings = {}

    Object.keys(current.marks).forEach(name=>{
        timings[name + '_ms'] = Math.max(0, current.marks[name] - current.started_at)
    })

    if(current.resolver_started_at){
        timings.resolver_ms = Math.max(0, (current.created_at || now) - current.resolver_started_at)
    }

    send({
        schema_version: 1,
        report_type: 'playback',
        captured_at: new Date().toISOString(),
        attempt_id: current.id,
        phase: current.phase,
        outcome: outcome || current.outcome,
        app: {
            version: Manifest.app_version
        },
        device: deviceInfo(),
        content: current.content,
        stream: current.stream,
        timings: timings,
        events: {
            waiting_count: current.waiting_count || 0,
            waiting_ms: Math.max(0, waiting || 0),
            stalled_count: current.stalled_count || 0,
            error: clampText(current.error || '', 240),
            fatal: Boolean(current.fatal)
        },
        diagnostics: diagnostics(current),
        requests: requestsSince(current.resolver_started_at || current.started_at)
    })
}

function newId(){
    return timestamp().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function finishStall(current, recovered){
    if(!current || !current.active_stall) return false

    let active = current.active_stall
    let end = snapshot(current)

    clearTimeout(active.report_timeout)

    current.stalls.push({
        sequence: active.sequence,
        trigger: active.trigger,
        duration_ms: elapsed(active.started_at),
        recovered: Boolean(recovered),
        classification: active.start && end ? classifyStall(active.start, end) : 'unknown',
        start: active.start,
        end: end
    })
    current.stalls = current.stalls.slice(-STALL_LIMIT)
    current.active_stall = null

    return true
}

function finishFrameFreeze(current, recovered){
    if(!current || !current.active_frame_freeze) return false

    let active = current.active_frame_freeze

    current.frame_freezes.push({
        sequence: active.sequence,
        kind: active.kind,
        duration_ms: elapsed(active.started_at),
        recovered: Boolean(recovered),
        start: active.start,
        end: snapshot(current)
    })
    current.frame_freezes = current.frame_freezes.slice(-FRAME_FREEZE_LIMIT)
    current.active_frame_freeze = null

    return true
}

function stopSampler(){
    clearInterval(sampleTimer)
    clearInterval(heartbeatTimer)
    sampleTimer = null
    heartbeatTimer = null
    stopFrameObserver()
}

function recordSample(){
    if(!attempt) return

    let current = snapshot(attempt)

    if(!current) return

    attempt.samples.push(current)
    attempt.samples = attempt.samples.slice(-SAMPLE_LIMIT)

    if(!attempt.marks.playing) return

    let issue = detectIssue(attempt.samples)
    let active = attempt.active_frame_freeze

    if(issue && (!active || active.kind !== issue)){
        if(active) finishFrameFreeze(attempt, true)

        attempt.frame_sequence++
        attempt.active_frame_freeze = {
            sequence: attempt.frame_sequence,
            kind: issue,
            started_at: Math.max(attempt.started_at, timestamp() - FRAME_WINDOW_MS),
            start: current
        }

        report(attempt, 'frame_freeze')
    }
    else if(!issue && active){
        finishFrameFreeze(attempt, true)
        report(attempt, 'playing')
    }
}

function startSampler(){
    stopSampler()
    recordSample()
    sampleTimer = setInterval(recordSample, SAMPLE_INTERVAL)
    heartbeatTimer = setInterval(()=>{
        if(!attempt || !attempt.marks.playing) return

        checkpoint(attempt)
        report(attempt, attempt.outcome)
    }, HEARTBEAT_INTERVAL)
}

function closeAttempt(outcome){
    if(!attempt) return

    clearTimeout(attempt.timeout)
    if(attempt.waiting_started){
        attempt.waiting_ms += elapsed(attempt.waiting_started)
        attempt.waiting_started = 0
    }

    finishStall(attempt, false)
    finishFrameFreeze(attempt, false)
    checkpoint(attempt)
    stopSampler()

    attempt.outcome = outcome || attempt.outcome
    report(attempt)
    attempt = null
}

function beginAttempt(data){
    if(attempt) closeAttempt('replaced')

    let startedAt = timestamp()
    let linkedResolver = resolver

    attempt = {
        id: linkedResolver ? linkedResolver.id : newId(),
        phase: 'player',
        outcome: 'starting',
        started_at: startedAt,
        created_at: startedAt,
        resolver_started_at: linkedResolver ? linkedResolver.started_at : 0,
        content: contentInfo(data),
        stream: streamInfo(data),
        marks: {
            create: startedAt
        },
        waiting_count: 0,
        waiting_ms: 0,
        waiting_started: 0,
        stalled_count: 0,
        samples: [],
        latest_checkpoint: null,
        control_events: [],
        control_grace_until: 0,
        hls: {
            fragment_loaded_count: 0,
            error_count: 0,
            level_switch_count: 0,
            last_level: 0,
            last_fragment_duration_ms: 0,
            last_fragment_bytes: 0
        },
        stalls: [],
        active_stall: null,
        stall_sequence: 0,
        frame_freezes: [],
        active_frame_freeze: null,
        frame_sequence: 0,
        error: '',
        fatal: false,
        timeout: setTimeout(()=>{
            if(!attempt || attempt.marks.playing) return

            attempt.outcome = 'timeout'
            report(attempt)
        }, PLAYBACK_TIMEOUT)
    }

    if(linkedResolver){
        clearTimeout(linkedResolver.timeout)
        resolver = null
    }

    startSampler()
}

function mark(name){
    if(!attempt) return

    if(!attempt.marks[name]) attempt.marks[name] = timestamp()
}

function onPlaying(){
    if(!attempt) return

    let firstPlaying = !attempt.marks.playing

    mark('playing')

    if(attempt.waiting_started){
        attempt.waiting_ms += elapsed(attempt.waiting_started)
        attempt.waiting_started = 0
    }

    let recovered = finishStall(attempt, true)

    if(firstPlaying){
        clearTimeout(attempt.timeout)
        attempt.outcome = 'playing'
        report(attempt)
    }
    else if(recovered){
        attempt.outcome = 'playing'
        report(attempt)
    }
}

function beginStall(trigger){
    if(!attempt || !attempt.marks.playing || attempt.active_stall) return

    attempt.stall_sequence++
    attempt.active_stall = {
        sequence: attempt.stall_sequence,
        trigger: trigger,
        started_at: timestamp(),
        start: snapshot(attempt),
        report_timeout: setTimeout(()=>{
            if(attempt && attempt.active_stall){
                report(attempt, 'waiting')
            }
        }, STALL_REPORT_DELAY)
    }
}

function onWaiting(){
    if(!attempt) return

    attempt.waiting_count++
    if(!attempt.waiting_started) attempt.waiting_started = timestamp()

    beginStall('waiting')
}

function onStalled(){
    if(!attempt) return

    attempt.stalled_count++
    beginStall('stalled')
}

function onError(event){
    if(!attempt) return

    attempt.error = event && event.error ? String(event.error) : 'unknown'
    attempt.fatal = Boolean(event && event.fatal)
    attempt.outcome = 'error'
    report(attempt)
}

function onControl(event){
    if(!attempt) return

    if(event && event.action == 'load' && typeof event.url == 'string'){
        try{ updateStreamInfo(attempt, Lampa.Player.playdata()) }
        catch(e){}

        attempt.stream.host = hostFromUrl(event.url)
        attempt.stream.type = streamType(event.url)
        attempt.stream.source_hash = streamHash(event.url)
    }

    appendControlEvent(attempt, 'command', event)
    attempt.control_grace_until = Math.max(attempt.control_grace_until, timestamp() + CONTROL_GRACE_MS)
}

function onMediaEvent(event){
    if(!attempt) return

    appendControlEvent(attempt, 'media', event)

    let name = event && (event.name || event.type)

    if(name == 'pause' || name == 'seeking' || name == 'seeked'){
        attempt.control_grace_until = Math.max(attempt.control_grace_until, timestamp() + CONTROL_GRACE_MS)
    }
}

function onEngine(event){
    if(!attempt) return

    event = event || {}
    attempt.stream.engine = firstSafeLabel([event.engine, event.name]) || 'unknown'

    appendControlEvent(attempt, 'engine', {
        name: attempt.stream.engine,
        reason: event.version ? 'version-' + safeLabel(String(event.version)) : ''
    })
}

function onHlsDiagnostic(event){
    if(!attempt) return

    event = event || {}
    let kind = safeLabel(event.kind || '')

    if(kind == 'fragment_loaded'){
        attempt.hls.fragment_loaded_count++
        attempt.hls.last_fragment_duration_ms = Math.max(0, Math.round(Number(event.duration_ms) || 0))
        attempt.hls.last_fragment_bytes = Math.max(0, Math.round(Number(event.bytes) || 0))
    }
    else if(kind == 'error'){
        attempt.hls.error_count++
        appendControlEvent(attempt, 'hls', {
            name: firstSafeLabel([event.details, kind]),
            reason: safeLabel(event.reason || ''),
            fatal: event.fatal
        })
    }
    else if(kind == 'level_switched'){
        attempt.hls.level_switch_count++
        attempt.hls.last_level = Math.max(0, Math.round(Number(event.level) || 0))
        appendControlEvent(attempt, 'hls', {name: kind, level: event.level})
    }
}

function resolverReport(current, outcome){
    report({
        id: current.id,
        phase: 'resolver',
        outcome: outcome,
        started_at: current.started_at,
        content: current.content,
        stream: {host: '', type: 'unknown', provider: ''},
        marks: {
            loading: current.started_at,
            stopped: timestamp()
        },
        waiting_count: 0,
        waiting_ms: 0,
        waiting_started: 0,
        stalled_count: 0,
        error: '',
        fatal: false
    })
}

function loadingEvent(event){
    if(!event || !event.type) return

    if(event.type == 'start'){
        let active = null

        try{
            active = Lampa.Activity.active()
        }
        catch(e){}

        if(!active || active.component !== 'full' || resolver || attempt) return

        resolver = {
            id: newId(),
            started_at: timestamp(),
            content: contentInfo(),
            timed_out: false
        }
        resolver.timeout = setTimeout(()=>{
            if(!resolver) return

            resolver.timed_out = true
            resolverReport(resolver, 'timeout')
        }, PLAYBACK_TIMEOUT)
    }
    else if(resolver && (event.type == 'stop' || event.type == 'cancel')){
        clearTimeout(resolver.timeout)

        if(resolver.timed_out || elapsed(resolver.started_at) >= RESOLVER_REPORT_THRESHOLD){
            resolverReport(resolver, event.type == 'cancel' ? 'cancelled' : 'completed_without_player')
        }

        resolver = null
    }
}

function init(){
    if(!CustomConfig.playbackMetricsEnabled) return

    Lampa.Listener.follow('request_before', requestStart)
    Lampa.Listener.follow('request_secuses', event=>requestFinish(event, 'success'))
    Lampa.Listener.follow('request_error', event=>requestFinish(event, 'error'))
    Lampa.Listener.follow('astronaut:loading', loadingEvent)

    Lampa.Player.listener.follow('create', event=>beginAttempt(event && event.data || {}))
    Lampa.Player.listener.follow('start', data=>{
        mark('start')
        updateStreamInfo(attempt, data)
    })
    Lampa.Player.listener.follow('ready', ()=>mark('ready'))
    Lampa.Player.listener.follow('external', ()=>{
        if(attempt){
            attempt.outcome = 'external'
            report(attempt)
        }
    })
    Lampa.Player.listener.follow('destroy', ()=>closeAttempt('closed'))

    Lampa.PlayerVideo.listener.follow('astronaut:loadstart', ()=>mark('loadstart'))
    Lampa.PlayerVideo.listener.follow('astronaut:loadedmetadata', ()=>mark('loadedmetadata'))
    Lampa.PlayerVideo.listener.follow('canplay', ()=>mark('canplay'))
    Lampa.PlayerVideo.listener.follow('astronaut:playing', onPlaying)
    Lampa.PlayerVideo.listener.follow('astronaut:waiting', onWaiting)
    Lampa.PlayerVideo.listener.follow('astronaut:stalled', onStalled)
    Lampa.PlayerVideo.listener.follow('astronaut:command', onControl)
    Lampa.PlayerVideo.listener.follow('astronaut:media', onMediaEvent)
    Lampa.PlayerVideo.listener.follow('astronaut:engine', onEngine)
    Lampa.PlayerVideo.listener.follow('astronaut:hls', onHlsDiagnostic)
    Lampa.PlayerVideo.listener.follow('error', onError)
    Lampa.PlayerVideo.listener.follow('ended', ()=>closeAttempt('ended'))
}

export default {
    init
}
