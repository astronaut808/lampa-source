#!/usr/bin/env node

'use strict'

const http = require('http')
const fs = require('fs').promises
const path = require('path')

const PORT = Number(process.env.METRICS_PORT || 9100)
const DATA_DIR = process.env.METRICS_DATA_DIR || '/data'
const DATA_FILE = path.join(DATA_DIR, 'startup-history.json')
const HISTORY_LIMIT = 20
const BODY_LIMIT = 64 * 1024

let history = []
let persistQueue = Promise.resolve()

const ready = fs.mkdir(DATA_DIR, {recursive: true}).then(()=>{
    return fs.readFile(DATA_FILE, 'utf8').then(data=>{
        let parsed = JSON.parse(data)

        history = Array.isArray(parsed) ? parsed.slice(-HISTORY_LIMIT) : []
    }).catch(error=>{
        if(error.code !== 'ENOENT') console.warn('Failed to load metrics history:', error.message)
    })
})

function respond(response, status, data){
    let body = JSON.stringify(data, null, 2) + '\n'

    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    })
    response.end(body)
}

function persist(){
    persistQueue = persistQueue.then(async ()=>{
        let temporary = DATA_FILE + '.tmp'

        await fs.writeFile(temporary, JSON.stringify(history, null, 2) + '\n', 'utf8')
        await fs.rename(temporary, DATA_FILE)
    }).catch(error=>{
        console.error('Failed to persist metrics:', error.message)
    })
}

function collect(request, response){
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
            let report = JSON.parse(Buffer.concat(chunks).toString('utf8'))

            if(!report || typeof report !== 'object' || report.schema_version !== 1){
                return respond(response, 400, {error: 'invalid_report'})
            }

            report.received_at = new Date().toISOString()
            history.push(report)
            history = history.slice(-HISTORY_LIMIT)

            persist()
            respond(response, 202, {stored: true, reports: history.length})
        }
        catch(error){
            respond(response, 400, {error: 'invalid_json'})
        }
    })
}

const server = http.createServer(async (request, response)=>{
    await ready

    let pathname = new URL(request.url, 'http://metrics.local').pathname

    if(request.method === 'GET' && pathname === '/health') return respond(response, 200, {status: 'ok'})
    if(request.method === 'GET' && pathname === '/metrics'){
        return respond(response, 200, history.length ? history[history.length - 1] : {status: 'waiting_for_first_report'})
    }
    if(request.method === 'GET' && pathname === '/metrics/history') return respond(response, 200, history)
    if(request.method === 'POST' && pathname === '/metrics/startup') return collect(request, response)

    respond(response, 404, {error: 'not_found'})
})

server.listen(PORT, '0.0.0.0', ()=>{
    console.log(`Startup metrics collector listening on port ${PORT}`)
})

function shutdown(){
    server.close(()=>process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
