import {describe, expect, it, vi} from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import Status from '../src/utils/status'

// Execute the complete production modules; only browser I/O is replaced.
function loadModule(path, globals){
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .* from .*$/gm, '')
        .replace('export default', 'globalThis.result =')
    const context = {...globals}
    vm.runInNewContext(source, context, {filename: path})
    return context.result
}

function setup({domain = 'cub.black', alive = 'https://cub.best', enabled = true, users = [], persist = true} = {}){
    const values = {cub_domain: domain, cub_mirrors: JSON.stringify(users)}
    if(alive !== null) values.cub_alive = alive
    const localStorage = {getItem: key=>values[key] ?? null}
    const window = {localStorage, lampa_settings: {mirrors: enabled}}
    const Manifest = loadModule('../src/core/manifest.js', {window, localStorage})
    const Storage = {set: vi.fn((key, value)=>{if(persist) values[key] = value})}
    const requests = [], callbacks = vi.fn()
    const Timer = {add: vi.fn()}
    const Markers = {normal: vi.fn(), error: vi.fn()}
    const Mirrors = loadModule('../src/core/mirrors.js', {
        Manifest, Storage, Status, Timer, Markers, window,
        $: {ajax: options=>requests.push(options)},
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}
    })
    return {
        values, Manifest, Storage, requests, callbacks, Timer, Markers, Mirrors,
        start(){Mirrors.task(callbacks)},
        reply(index, success){
            const request = requests[index]
            if(success) request.success(request.data.data)
            else request.error()
        }
    }
}

describe('CUB mirror selection', ()=>{
    it('checks the selected domain instead of a stale cached mirror', ()=>{
        const s = setup()
        s.start()
        expect(s.requests[0].url).toBe('https://cub.black/api/checker')
        expect(s.Storage.set.mock.calls).toEqual([['cub_alive', 'https://cub.black', true]])
        s.reply(0, true)
        expect(s.callbacks).toHaveBeenCalledTimes(1)
        expect(s.Manifest.cub_domain).toBe('cub.black')
        expect(s.requests).toHaveLength(1)
    })

    it.each(['https://notcub.black', 'https://sub.cub.black', 'https://example.invalid/cub.black'])('rejects substring-only matches: %s', alive=>{
        const s = setup({alive})
        s.start()
        expect(s.requests[0].url).toBe('https://cub.black/api/checker')
    })

    it.each(['http://', 'https://'])('preserves a matching %s mirror without rewriting it', protocol=>{
        const s = setup({alive: protocol + 'cub.black'})
        s.start(); s.reply(0, true)
        expect(s.requests[0].url).toBe(protocol + 'cub.black/api/checker')
        expect(s.requests).toHaveLength(1)
        expect(s.Storage.set).not.toHaveBeenCalled()
        expect(s.callbacks).toHaveBeenCalledTimes(1)
    })

    it.each(['http://', 'https://'])('preserves custom hosts and ports with %s', protocol=>{
        const domain = 'home.example:8443'
        const s = setup({domain, alive: protocol + domain, users: [domain]})
        s.start()
        expect(s.requests[0].url).toBe(protocol + domain + '/api/checker')
        expect(s.Storage.set).not.toHaveBeenCalled()
    })

    it('uses the default HTTPS address when no cached address exists', ()=>{
        const s = setup({alive: null})
        s.start()
        expect(s.requests[0].url).toBe('https://cub.black/api/checker')
        expect(s.Storage.set).not.toHaveBeenCalled()
    })

    it('respects the effective domain when an obsolete selection is no longer listed', ()=>{
        const s = setup({domain: 'obsolete.invalid', alive: 'https://obsolete.invalid'})
        s.start()
        expect(s.requests[0].url).toBe('https://cub.best/api/checker')
    })

    it('does not depend on a successful persistent storage write', ()=>{
        const s = setup({persist: false})
        s.start()
        expect(s.values.cub_alive).toBe('https://cub.best')
        expect(s.requests[0].url).toBe('https://cub.black/api/checker')
        s.reply(0, true)
        expect(s.callbacks).toHaveBeenCalledTimes(1)
    })

    it('does not rewrite the mirror again on a subsequent successful check', ()=>{
        const s = setup()
        s.start(); s.reply(0, true)
        s.start(); s.reply(1, true)
        expect(s.Storage.set).toHaveBeenCalledTimes(1)
        expect(s.requests).toHaveLength(2)
        expect(s.callbacks).toHaveBeenCalledTimes(2)
    })

    it('skips requests and storage writes when mirror checking is disabled', ()=>{
        const s = setup({enabled: false})
        s.start()
        expect(s.requests).toHaveLength(0)
        expect(s.Storage.set).not.toHaveBeenCalled()
        expect(s.callbacks).toHaveBeenCalledTimes(1)
        expect(()=>s.Mirrors.task()).not.toThrow()
    })

    it('keeps parallel fallback checks, HTTPS preference and the existing timeout', ()=>{
        const s = setup()
        s.start(); s.reply(0, false)
        const count = s.Manifest.cub_mirrors.length
        expect(s.requests).toHaveLength(1 + count * 2)
        expect(s.requests.every(request=>request.timeout === 7000 && request.type === 'POST')).toBe(true)
        // Complete HTTP first: preference must not depend on response order.
        for(let i = 1 + count; i < s.requests.length; i++) s.reply(i, i === 1 + count)
        expect(s.callbacks).not.toHaveBeenCalled()
        for(let i = 1; i <= count; i++) s.reply(i, i === 1)
        expect(s.callbacks).toHaveBeenCalledTimes(1)
        expect(s.values.cub_alive).toBe('https://cub.best')
        expect(s.values.cub_domain).toBe('cub.best')
        expect(s.Mirrors.connected()).toBe(true)
        expect(s.Markers.normal).toHaveBeenCalledWith('mirrors')
        expect(s.Storage.set.mock.calls.every(call=>call[2] === true)).toBe(true)
    })

    it('falls back to HTTP when no HTTPS mirror answers', ()=>{
        const s = setup()
        s.start(); s.reply(0, false)
        const count = s.Manifest.cub_mirrors.length
        for(let i = 1; i < s.requests.length; i++) s.reply(i, i === 1 + count)
        expect(s.callbacks).toHaveBeenCalledTimes(1)
        expect(s.values.cub_alive).toBe('http://cub.best')
        expect(s.Mirrors.connected()).toBe(true)
    })

    it('continues once and reports disconnected when all mirrors fail', ()=>{
        const s = setup()
        s.start(); s.reply(0, false)
        for(let i = 1; i < s.requests.length; i++) s.reply(i, false)
        expect(s.callbacks).toHaveBeenCalledTimes(1)
        expect(s.Mirrors.connected()).toBe(false)
        expect(s.Markers.error).toHaveBeenCalledWith('mirrors')
        expect(s.Storage.set.mock.calls.some(call=>call[0] === 'cub_domain')).toBe(false)
    })

    it('rejects an invalid checker response before falling back', ()=>{
        const s = setup()
        s.start()
        s.requests[0].success('not the echoed request value')
        expect(s.requests).toHaveLength(1 + s.Manifest.cub_mirrors.length * 2)
        expect(s.callbacks).not.toHaveBeenCalled()
    })

    it('retains periodic checks every fifteen minutes without requiring a callback', ()=>{
        const s = setup()
        s.Mirrors.init()
        expect(s.Timer.add).toHaveBeenCalledTimes(1)
        expect(s.Timer.add.mock.calls[0][0]).toBe(900000)
        s.Timer.add.mock.calls[0][1]()
        expect(s.requests[0].url).toBe('https://cub.black/api/checker')
        expect(()=>s.reply(0, true)).not.toThrow()
    })
})
