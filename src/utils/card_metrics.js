import Manifest from '../core/manifest'
import CustomConfig from '../custom/config'

const SLOW_CARD_THRESHOLD = 15000
const REQUEST_LIMIT = 40

let attempt = null

function timestamp(){
    return Date.now()
}

function elapsed(start){
    return Math.max(0, timestamp() - start)
}

function clampText(value, limit){
    return typeof value == 'string' ? value.slice(0, limit) : ''
}

function hash(value){
    let result = 2166136261

    for(let i = 0; i < value.length; i++){
        result ^= value.charCodeAt(i)
        result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24)
    }

    return (result >>> 0).toString(16)
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
    if(/\/3\/(movie|tv)\/\d+\/?$/.test(path)) return 'details'

    return 'other'
}

function safeLabel(value, limit = 40){
    if(typeof value !== 'string' || value.indexOf('://') >= 0) return ''

    return value.slice(0, limit)
}

function contentInfo(object, movie){
    object = object || {}
    movie = movie || object.card || {}

    let source = movie.source || object.source || ''
    let id = movie.id || object.id || ''
    let identity = source + ':' + id

    return {
        id_hash: id ? hash(identity) : '',
        media_type: safeLabel(movie.media_type || object.method || ''),
        source: safeLabel(source)
    }
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

function newId(){
    return timestamp().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function requestStart(event){
    if(!attempt || !event?.params) return

    attempt.pending.push({
        params: event.params,
        started_at: timestamp(),
        host: hostFromUrl(event.params.url),
        kind: requestKind(event.params.url)
    })

    if(attempt.pending.length > REQUEST_LIMIT) attempt.pending.shift()
}

function requestFinish(event, outcome){
    if(!attempt || !event?.params) return

    let index = -1

    for(let i = attempt.pending.length - 1; i >= 0; i--){
        if(attempt.pending[i].params === event.params){
            index = i
            break
        }
    }

    if(index < 0) return

    let pending = attempt.pending.splice(index, 1)[0]
    let status = event.error && Number(event.error.status) || Number(event.status) || 0

    attempt.requests.push({
        host: pending.host,
        kind: pending.kind,
        duration_ms: elapsed(pending.started_at),
        outcome,
        status
    })

    attempt.requests = attempt.requests.slice(-REQUEST_LIMIT)
}

function requestSnapshot(current){
    let completed = current.requests.slice()
    let pending = current.pending.map(item=>({
        host: item.host,
        kind: item.kind,
        duration_ms: elapsed(item.started_at),
        outcome: 'pending',
        status: 0
    }))

    return completed.concat(pending).slice(-REQUEST_LIMIT)
}

function send(report){
    let body = JSON.stringify(report)

    try{
        if(navigator.sendBeacon){
            let blob = new Blob([body], {type: 'application/json'})

            if(navigator.sendBeacon('/metrics/card', blob)) return
        }
    }
    catch(e){}

    try{
        let request = new XMLHttpRequest()
            request.open('POST', '/metrics/card', true)
            request.setRequestHeader('Content-Type', 'application/json')
            request.timeout = 3000
            request.send(body)
    }
    catch(e){}
}

function report(current, outcome){
    let now = timestamp()
    let apiFinished = current.api_finished_at || 0
    let completed = current.completed_at || now

    send({
        schema_version: 1,
        report_type: 'card',
        captured_at: new Date().toISOString(),
        attempt_id: current.id,
        outcome,
        app: {
            version: Manifest.app_version
        },
        device: deviceInfo(),
        content: current.content,
        timings: {
            api_ms: apiFinished ? Math.max(0, apiFinished - current.started_at) : 0,
            render_ms: apiFinished && current.completed_at ? Math.max(0, current.completed_at - apiFinished) : 0,
            total_ms: Math.max(0, completed - current.started_at)
        },
        events: {
            slow: current.slow,
            error: safeLabel(current.error, 80)
        },
        requests: requestSnapshot(current)
    })
}

function finish(outcome, error){
    if(!attempt) return

    let current = attempt
        attempt = null

    clearTimeout(current.timeout)
    current.completed_at = timestamp()
    current.error = error || ''

    if(outcome == 'error' && !current.error){
        let failed = current.requests.slice().reverse().find(item=>item.outcome == 'error')

        current.error = failed?.status ? 'http_' + failed.status : 'request_error'
    }

    report(current, outcome)
}

function begin(object){
    if(attempt) finish('replaced')

    let current = {
        id: newId(),
        object,
        started_at: timestamp(),
        api_finished_at: 0,
        completed_at: 0,
        content: contentInfo(object),
        requests: [],
        pending: [],
        slow: false,
        error: ''
    }

    current.timeout = setTimeout(()=>{
        if(attempt !== current) return

        current.slow = true
        report(current, 'timeout')
    }, SLOW_CARD_THRESHOLD)

    attempt = current
}

function activityEvent(event){
    if(!event || event.component !== 'full') return

    if(event.type == 'init') begin(event.object)
    else if(event.type == 'destroy' && attempt?.object === event.object) finish('cancelled')
}

function fullEvent(event){
    if(!attempt || !event || attempt.object !== event.object) return

    if(event.type == 'start'){
        attempt.api_finished_at = timestamp()
        attempt.content = contentInfo(event.object, event.data?.movie)
    }
    else if(event.type == 'complite') finish('success')
}

function cardEvent(event){
    if(!attempt || !event || attempt.object !== event.object || event.type !== 'error') return

    let reason = event.error?.empty ? 'not_found' : event.error?.blocked ? 'blocked' : ''

    finish('error', reason)
}

function init(){
    if(!CustomConfig.cardMetricsEnabled) return

    Lampa.Listener.follow('activity', activityEvent)
    Lampa.Listener.follow('full', fullEvent)
    Lampa.Listener.follow('astronaut:card', cardEvent)
    Lampa.Listener.follow('request_before', requestStart)
    Lampa.Listener.follow('request_secuses', event=>requestFinish(event, 'success'))
    Lampa.Listener.follow('request_error', event=>requestFinish(event, 'error'))
}

export default {
    init
}
