import Manifest from '../core/manifest'

let marks = []
let finished = false
let catalogFinished = false
let attemptId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)

function now(){
    if(window.performance && typeof window.performance.now == 'function') return window.performance.now()

    return Date.now() - (window.app_time_start || Date.now())
}

function round(value){
    return Math.round((value || 0) * 10) / 10
}

function mark(name){
    if(finished) return

    marks.push({name: name, at_ms: round(now())})
}

function find(name){
    for(let i = 0; i < marks.length; i++){
        if(marks[i].name == name) return marks[i]
    }
}

function span(from, to){
    let start = find(from)
    let end   = find(to)

    return start && end ? round(end.at_ms - start.at_ms) : null
}

function resourceName(url){
    try{
        let parsed = document.createElement('a')
            parsed.href = url

        return (parsed.host == window.location.host ? '' : parsed.host) + parsed.pathname
    }
    catch(e){
        return 'unknown'
    }
}

function navigation(){
    try{
        let entry = performance.getEntriesByType('navigation')[0]

        if(entry){
            return {
                dns_ms: round(entry.domainLookupEnd - entry.domainLookupStart),
                connect_ms: round(entry.connectEnd - entry.connectStart),
                response_ms: round(entry.responseEnd - entry.requestStart),
                dom_interactive_ms: round(entry.domInteractive),
                dom_content_loaded_ms: round(entry.domContentLoadedEventEnd),
                load_event_ms: round(entry.loadEventEnd)
            }
        }
    }
    catch(e){}

    return {}
}

function resources(){
    let entries = []

    try{
        entries = performance.getEntriesByType('resource') || []
    }
    catch(e){}

    let total_transfer = 0
    let total_decoded  = 0
    let slowest = entries.map(entry=>{
        total_transfer += entry.transferSize || 0
        total_decoded  += entry.decodedBodySize || 0

        return {
            name: resourceName(entry.name),
            type: entry.initiatorType || 'unknown',
            duration_ms: round(entry.duration),
            transfer_bytes: entry.transferSize || 0,
            decoded_bytes: entry.decodedBodySize || 0
        }
    }).sort((a,b)=>b.duration_ms - a.duration_ms).slice(0,15)

    return {
        count: entries.length,
        transfer_bytes: total_transfer,
        decoded_bytes: total_decoded,
        slowest: slowest
    }
}

function pluginStats(){
    try{
        if(window.Lampa && Lampa.Plugins){
            return {
                configured: Lampa.Plugins.awaits().length,
                loaded: Lampa.Plugins.loaded().length,
                failed: Lampa.Plugins.errors().length
            }
        }
    }
    catch(e){}

    return {configured: 0, loaded: 0, failed: 0}
}

function accountState(){
    try{
        let permit = window.Lampa && Lampa.Account ? Lampa.Account.Permit : null

        return {
            signed_in: Boolean(permit && permit.access),
            sync_enabled: Boolean(permit && permit.sync)
        }
    }
    catch(e){}

    return {signed_in: false, sync_enabled: false}
}

function snapshot(){
    let settings = window.lampa_settings || {}
    let ready    = find('Send app ready')
    let visible  = find('UI visible')
    let plugins  = pluginStats()
    let account  = accountState()

    return {
        schema_version: 1,
        attempt_id: attemptId,
        captured_at: new Date().toISOString(),
        app: {
            name: 'Astronaut Lampa',
            version: Manifest.app_version
        },
        device: {
            user_agent: navigator.userAgent,
            language: navigator.language || '',
            screen: window.screen.width + 'x' + window.screen.height,
            viewport: window.innerWidth + 'x' + window.innerHeight,
            pixel_ratio: window.devicePixelRatio || 1
        },
        totals: {
            app_ready_ms: ready ? ready.at_ms : null,
            ui_visible_ms: visible ? visible.at_ms : null,
            catalog_ready_ms: find('Catalog ready')?.at_ms || null
        },
        critical_path: {
            cache_ms: span('Open cache database', 'Storage load reserve'),
            storage_ms: span('Storage load reserve', 'Mirrors initialization'),
            mirrors_ms: span('Mirrors initialization', 'Plugins initialization'),
            plugins_init_ms: span('Plugins initialization', 'Proxy initialization'),
            proxy_ms: span('Proxy initialization', 'Account initialization'),
            account_ms: span('Account initialization', 'Loading plugins'),
            plugins_load_ms: span('Loading plugins', 'Show app'),
            ui_to_catalog_ms: span('UI visible', 'Catalog ready')
        },
        features: {
            cub_signed_in: account.signed_in,
            cub_sync_enabled: account.sync_enabled,
            plugins_use: Boolean(settings.plugins_use),
            plugins_store: Boolean(settings.plugins_store),
            configured_plugins: plugins.configured,
            loaded_plugins: plugins.loaded,
            failed_plugins: plugins.failed,
            geo: Boolean(settings.geo),
            mirrors: Boolean(settings.mirrors),
            services: Boolean(settings.services),
            youtube: Boolean(settings.youtube),
            iptv_mode: Boolean(settings.iptv)
        },
        navigation: navigation(),
        resources: resources(),
        timeline: marks.map((item, index)=>{
            let next = marks[index + 1]

            return {
                name: item.name,
                at_ms: item.at_ms,
                until_next_ms: next ? round(next.at_ms - item.at_ms) : 0
            }
        })
    }
}

function send(report){
    let body = JSON.stringify(report)

    try{
        if(navigator.sendBeacon){
            let blob = new Blob([body], {type: 'application/json'})

            if(navigator.sendBeacon('/metrics/startup', blob)) return
        }
    }
    catch(e){}

    try{
        let request = new XMLHttpRequest()
            request.open('POST', '/metrics/startup', true)
            request.setRequestHeader('Content-Type', 'application/json')
            request.timeout = 3000
            request.send(body)
    }
    catch(e){}
}

function finish(){
    if(finished) return

    mark('UI visible')

    finished = true

    setTimeout(()=>send(snapshot()), 250)
}

function catalogReady(){
    if(catalogFinished) return

    catalogFinished = true
    marks.push({name: 'Catalog ready', at_ms: round(now())})

    if(finished) setTimeout(()=>send(snapshot()), 0)
}

export default {
    mark,
    finish,
    catalogReady,
    snapshot
}
