import Manifest from '../core/manifest'
import CustomConfig from '../custom/config'

const PLAYBACK_TIMEOUT = 30000
const RESOLVER_REPORT_THRESHOLD = 2000
const REQUEST_WINDOW = 30000
const REQUEST_RETENTION = 120000
const REQUEST_LIMIT = 50

let attempt = null
let resolver = null
let recentRequests = []
let pendingRequests = []

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

function streamInfo(data){
    data = data || {}

    return {
        host: hostFromUrl(data.url),
        type: streamType(data.url),
        provider: safeLabel(data.balancer || data.provider || data.source || data.from || '')
    }
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

function report(current){
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
        outcome: current.outcome,
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
        requests: requestsSince(current.resolver_started_at || current.started_at)
    })
}

function newId(){
    return timestamp().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function closeAttempt(outcome){
    if(!attempt) return

    clearTimeout(attempt.timeout)

    if(attempt.waiting_started){
        attempt.waiting_ms += elapsed(attempt.waiting_started)
        attempt.waiting_started = 0
    }

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

    if(firstPlaying){
        clearTimeout(attempt.timeout)
        attempt.outcome = 'playing'
        report(attempt)
    }
}

function onWaiting(){
    if(!attempt) return

    attempt.waiting_count++
    if(!attempt.waiting_started) attempt.waiting_started = timestamp()
}

function onError(event){
    if(!attempt) return

    attempt.error = event && event.error ? String(event.error) : 'unknown'
    attempt.fatal = Boolean(event && event.fatal)
    attempt.outcome = 'error'
    report(attempt)
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
    Lampa.Player.listener.follow('start', ()=>mark('start'))
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
    Lampa.PlayerVideo.listener.follow('astronaut:stalled', ()=>{
        if(attempt) attempt.stalled_count++
    })
    Lampa.PlayerVideo.listener.follow('error', onError)
    Lampa.PlayerVideo.listener.follow('ended', ()=>closeAttempt('ended'))
}

export default {
    init
}
