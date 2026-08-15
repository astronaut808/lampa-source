'use strict'

const dns = require('dns').promises
const http = require('http')
const https = require('https')

const DEFAULT_INTERVAL = 60 * 1000
const DEFAULT_TIMEOUT = 5000
const DEFAULT_DNS_TARGETS = 'tmdb_images=image.tmdb.org,cub_api=apitmdb.cub.rip,cub=cub.rip'
const DEFAULT_HTTP_TARGETS = 'lampa=http://lampa:8080/healthz,cub=https://cub.rip/'

function number(value, fallback, minimum, maximum){
    value = Number(value)

    return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
}

function safeName(value){
    value = typeof value === 'string' ? value.trim().toLowerCase() : ''

    return /^[a-z0-9_-]{1,40}$/.test(value) ? value : ''
}

function parseTargets(value, fallback){
    return (value || fallback).split(',').map(item=>{
        let separator = item.indexOf('=')
        let name = safeName(separator >= 0 ? item.slice(0, separator) : '')
        let target = separator >= 0 ? item.slice(separator + 1).trim() : ''

        return name && target ? {name, target} : null
    }).filter(Boolean)
}

function addressScope(address){
    let value = String(address || '').toLowerCase()

    if(value.startsWith('::ffff:')) value = value.slice(7)

    if(value === '::1' || value.startsWith('127.')) return 'loopback'
    if(value === '0.0.0.0' || value === '::') return 'unspecified'
    if(value.startsWith('10.') || value.startsWith('192.168.') || value.startsWith('169.254.')) return 'private'
    if(/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return 'private'
    if(value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return 'private'

    return 'public'
}

function errorCode(error){
    let code = error && typeof error.code === 'string' ? error.code.toUpperCase() : ''

    return /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'UNKNOWN'
}

async function checkDns(target){
    let startedAt = Date.now()

    try{
        let addresses = await dns.lookup(target.target, {all: true, verbatim: true})
        let scopes = addresses.map(item=>addressScope(item.address))
        let publicCount = scopes.filter(scope=>scope === 'public').length

        return {
            name: target.name,
            kind: 'dns',
            outcome: publicCount ? 'ok' : 'blocked',
            duration_ms: Date.now() - startedAt,
            address_count: addresses.length,
            public_count: publicCount,
            private_count: scopes.filter(scope=>scope === 'private').length,
            loopback_count: scopes.filter(scope=>scope === 'loopback').length,
            status: 0,
            error_code: ''
        }
    }
    catch(error){
        return {
            name: target.name,
            kind: 'dns',
            outcome: 'error',
            duration_ms: Date.now() - startedAt,
            address_count: 0,
            public_count: 0,
            private_count: 0,
            loopback_count: 0,
            status: 0,
            error_code: errorCode(error)
        }
    }
}

function checkHttp(target, timeout){
    return new Promise(resolve=>{
        let startedAt = Date.now()
        let url

        try{
            url = new URL(target.target)
        }
        catch(error){
            return resolve({
                name: target.name,
                kind: 'http',
                outcome: 'error',
                duration_ms: 0,
                status: 0,
                error_code: 'INVALID_URL'
            })
        }

        let client = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null

        if(!client){
            return resolve({
                name: target.name,
                kind: 'http',
                outcome: 'error',
                duration_ms: 0,
                status: 0,
                error_code: 'INVALID_PROTOCOL'
            })
        }

        let completed = false
        let finish = result=>{
            if(completed) return

            completed = true
            resolve(Object.assign({
                name: target.name,
                kind: 'http',
                duration_ms: Date.now() - startedAt
            }, result))
        }

        let request = client.get(url, {
            headers: {'User-Agent': 'Astronaut-Lampa-Synthetic/1.0'}
        }, response=>{
            response.resume()
            finish({
                outcome: response.statusCode >= 200 && response.statusCode < 400 ? 'ok' : 'http_error',
                status: response.statusCode || 0,
                error_code: ''
            })
        })

        request.setTimeout(timeout, ()=>request.destroy(Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'})))
        request.on('error', error=>finish({
            outcome: 'error',
            status: 0,
            error_code: errorCode(error)
        }))
    })
}

function createSyntheticMonitor(options = {}){
    let enabled = options.enabled !== false
    let interval = number(options.interval, DEFAULT_INTERVAL, 10000, 24 * 60 * 60 * 1000)
    let timeout = number(options.timeout, DEFAULT_TIMEOUT, 500, 30000)
    let dnsTargets = parseTargets(options.dnsTargets, DEFAULT_DNS_TARGETS)
    let httpTargets = parseTargets(options.httpTargets, DEFAULT_HTTP_TARGETS)
    let onResult = typeof options.onResult === 'function' ? options.onResult : ()=>{}
    let timer = null
    let running = null

    async function run(){
        if(!enabled) return null
        if(running) return running

        running = Promise.all(
            dnsTargets.map(checkDns).concat(httpTargets.map(target=>checkHttp(target, timeout)))
        ).then(checks=>{
            let result = {
                schema_version: 1,
                report_type: 'synthetic',
                captured_at: new Date().toISOString(),
                outcome: checks.every(check=>check.outcome === 'ok') ? 'ok' : 'degraded',
                checks
            }

            onResult(result)

            return result
        }).finally(()=>{
            running = null
        })

        return running
    }

    function start(){
        if(!enabled || timer) return

        run()
        timer = setInterval(run, interval)
        timer.unref?.()
    }

    function stop(){
        if(timer) clearInterval(timer)
        timer = null
    }

    return {
        run,
        start,
        stop,
        enabled
    }
}

module.exports = {
    addressScope,
    createSyntheticMonitor,
    parseTargets
}
