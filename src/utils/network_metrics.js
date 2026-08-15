import Manifest from '../core/manifest'
import CustomConfig from '../custom/config'

const FLUSH_INTERVAL = 5000
const BATCH_LIMIT = 20
const QUEUE_LIMIT = 100
const PENDING_LIMIT = 100
const PENDING_THRESHOLD = 35000
const PENDING_SWEEP_INTERVAL = 5000

let pending = []
let queue = []
let flushTimer = 0

function timestamp(){
    return Date.now()
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

function hash(value){
    let result = 2166136261

    for(let i = 0; i < value.length; i++){
        result ^= value.charCodeAt(i)
        result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24)
    }

    return (result >>> 0).toString(16)
}

function routeHash(value){
    if(typeof value !== 'string' || !value) return ''

    try{
        let link = document.createElement('a')
            link.href = value

        return hash(link.pathname || '/')
    }
    catch(e){
        return ''
    }
}

function requestKind(value){
    if(typeof value !== 'string') return 'other'

    let path = value.toLowerCase().split('?')[0]

    if(path.indexOf('/credits') >= 0) return 'credits'
    if(path.indexOf('/recommendations') >= 0) return 'recommendations'
    if(path.indexOf('/similar') >= 0) return 'similar'
    if(path.indexOf('/videos') >= 0) return 'videos'
    if(path.indexOf('/season/') >= 0) return 'season'
    if(path.indexOf('/collection/') >= 0) return 'collection'
    if(path.indexOf('/api/reactions/') >= 0) return 'reactions'
    if(path.indexOf('/api/discuss/') >= 0) return 'discuss'
    if(path.indexOf('/metadata') >= 0) return 'metadata'
    if(path.indexOf('/api/') >= 0 && path.indexOf('/account') >= 0) return 'account'
    if(path.indexOf('/socket') >= 0) return 'socket'
    if(path.indexOf('.m3u8') >= 0) return 'hls'
    if(path.indexOf('.mpd') >= 0) return 'dash'
    if(path.indexOf('.js') >= 0) return 'plugin'
    if(/\/3\/(movie|tv)\/\d+\/?$/.test(path)) return 'details'

    return 'other'
}

function requestMethod(params){
    if(params?.method) return clampText(String(params.method).toUpperCase(), 10)

    return params?.post_data ? 'POST' : 'GET'
}

function currentContext(){
    try{
        return clampText(Lampa.Activity.active()?.component || 'unknown', 30)
    }
    catch(e){
        return 'unknown'
    }
}

function errorKind(event, status){
    let exception = clampText(event?.exception || '', 40).toLowerCase()

    if(exception == 'timeout') return 'timeout'
    if(exception == 'abort') return 'abort'
    if(status == 0) return 'network'
    if(status == 401 || status == 403) return 'access'
    if(status == 404) return 'not_found'
    if(status == 408 || status == 429) return 'retryable_http'
    if(status >= 500) return 'server'
    if(status >= 400) return 'client'

    return 'unknown'
}

function newId(){
    return timestamp().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function scheduleFlush(){
    if(flushTimer) return

    flushTimer = setTimeout(()=>{
        flushTimer = 0
        flush()
    }, FLUSH_INTERVAL)
}

function enqueue(event){
    queue.push(event)
    queue = queue.slice(-QUEUE_LIMIT)

    if(queue.length >= BATCH_LIMIT) flush()
    else scheduleFlush()
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

function transmit(events){
    let body = JSON.stringify({
        schema_version: 1,
        report_type: 'network_batch',
        captured_at: new Date().toISOString(),
        app: {version: Manifest.app_version},
        device: deviceInfo(),
        events
    })

    try{
        if(navigator.sendBeacon){
            let blob = new Blob([body], {type: 'application/json'})

            if(navigator.sendBeacon('/metrics/network', blob)) return
        }
    }
    catch(e){}

    try{
        let request = new XMLHttpRequest()
            request.open('POST', '/metrics/network', true)
            request.setRequestHeader('Content-Type', 'application/json')
            request.timeout = 3000
            request.send(body)
    }
    catch(e){}
}

function flush(){
    if(!queue.length) return

    let events = queue.splice(0, BATCH_LIMIT)

    transmit(events)

    if(queue.length) scheduleFlush()
}

function requestStart(event){
    if(!event?.params) return

    pending.push({
        id: newId(),
        params: event.params,
        started_at: timestamp(),
        host: hostFromUrl(event.params.url),
        route_hash: routeHash(event.params.url),
        kind: requestKind(event.params.url),
        method: requestMethod(event.params),
        context: currentContext(),
        retries: 0,
        reported_pending: false
    })

    if(pending.length > PENDING_LIMIT) pending.shift()
}

function pendingEvent(item){
    return {
        request_id: item.id,
        occurred_at: new Date().toISOString(),
        host: item.host,
        route_hash: item.route_hash,
        kind: item.kind,
        method: item.method,
        context: item.context,
        outcome: 'pending',
        status: 0,
        error_kind: 'pending',
        duration_ms: Math.max(0, timestamp() - item.started_at),
        retries: item.retries,
        from_cache: false,
        online: navigator.onLine !== false
    }
}

function sweepPending(){
    pending.forEach(item=>{
        if(!item.reported_pending && timestamp() - item.started_at >= PENDING_THRESHOLD){
            item.reported_pending = true
            enqueue(pendingEvent(item))
        }
    })
}

function pageHide(){
    flush()
}

function findPending(params){
    for(let i = pending.length - 1; i >= 0; i--){
        if(pending[i].params === params) return i
    }

    return -1
}

function requestRetry(event){
    let index = findPending(event?.params)

    if(index >= 0) pending[index].retries++
}

function requestFinish(event, outcome){
    let index = findPending(event?.params)

    if(index < 0) return

    let item = pending.splice(index, 1)[0]
    let status = event?.error && Number(event.error.status) || Number(event?.status) || 0

    enqueue({
        request_id: item.id,
        occurred_at: new Date().toISOString(),
        host: item.host,
        route_hash: item.route_hash,
        kind: item.kind,
        method: item.method,
        context: item.context,
        outcome,
        status,
        error_kind: outcome == 'error' ? errorKind(event, status) : '',
        duration_ms: Math.max(0, timestamp() - item.started_at),
        retries: item.retries,
        from_cache: Boolean(event?.fromcache),
        online: navigator.onLine !== false
    })
}

function init(){
    if(!CustomConfig.networkMetricsEnabled) return

    Lampa.Listener.follow('request_before', requestStart)
    Lampa.Listener.follow('request_retry', requestRetry)
    Lampa.Listener.follow('request_secuses', event=>requestFinish(event, 'success'))
    Lampa.Listener.follow('request_error', event=>requestFinish(event, 'error'))

    setInterval(sweepPending, PENDING_SWEEP_INTERVAL)
    window.addEventListener('pagehide', pageHide)
}

export default {
    init
}
