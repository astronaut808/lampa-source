import {describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'

function setup(runtime = {}){
    const window = {LampaRuntimeConfig: runtime}
    const CustomConfig = loadBrowserModule('src/custom/config.js', {window})
    const values = {}
    const Storage = {
        get: vi.fn((key, fallback)=>values[key] ?? fallback),
        set: vi.fn((key, value)=>{values[key] = value})
    }
    const ajax = vi.fn(), follow = vi.fn()
    const Metric = loadBrowserModule('src/services/metric.js', {
        CustomConfig, Storage,
        Manifest: {cub_domain: 'cub.example'},
        Utils: {protocol: ()=> 'https://', uid: vi.fn(()=> 'test-uid')},
        Platform: {get: ()=> 'vidaa', screen: ()=>true},
        Account: {hasPremium: ()=>false}, VPN: {code: ()=> 'test'},
        $: {ajax}, Lampa: {Player: {listener: {follow}}}
    })
    return {Metric, ajax, follow, Storage}
}

function setupConsole(runtime = {}){
    const window = {LampaRuntimeConfig: runtime, addEventListener: vi.fn()}
    const CustomConfig = loadBrowserModule('src/custom/config.js', {window})
    const console = {log: vi.fn(), error: vi.fn(), warn: vi.fn()}
    const Socket = {send: vi.fn(), terminalAccess: ()=>true}
    const Logger = loadBrowserModule('src/interaction/console.js', {
        window, CustomConfig, console, Socket,
        Keypad: {listener: {follow: vi.fn()}}, Controller: {add: vi.fn()},
        Timer: {add: vi.fn()}, Storage: {get: ()=> 'previously-configured-terminal'},
        Utils: {shortText: text=>text},
        Arrays: {isObject: value=>value && typeof value === 'object', isArray: Array.isArray,
            insert: (array, index, value)=>array.splice(index, 0, value)}
    })
    Logger.init()
    return {Logger, console, Socket}
}

describe('external CUB telemetry policy', ()=>{
    it.each([undefined, false, 'false', 'true', 0, 1])('does not collect or send telemetry with flag %s', value=>{
        const s = setup({cubTelemetryEnabled: value})
        s.Metric.init()
        s.Metric.counter('player_start', 'vidaa')
        s.Metric.histogram('adview', 10)
        expect(s.ajax).not.toHaveBeenCalled()
        expect(s.Storage.get).not.toHaveBeenCalled()
        expect(s.Storage.set).not.toHaveBeenCalled()
        expect(s.follow).not.toHaveBeenCalled()
    })

    it('has a working positive control for explicitly enabled telemetry', ()=>{
        const s = setup({cubTelemetryEnabled: true})
        s.Metric.init()
        s.Metric.counter('player_start', 'vidaa')
        s.Metric.histogram('adview', 10)
        const urls = s.ajax.mock.calls.map(([request])=>request.url)
        expect(urls.some(url=>url.includes('/api/metric/unic?'))).toBe(true)
        expect(urls.some(url=>url.includes('/api/metric/stat?method=player_start'))).toBe(true)
        expect(urls.some(url=>url.includes('/api/metric/histogram?method=adview'))).toBe(true)
        expect(s.follow.mock.calls.map(([event])=>event)).toEqual(['start', 'external'])
    })

    it('keeps console logs local even if an old remote-terminal code is saved', ()=>{
        const s = setupConsole()
        s.console.log('Player', 'example')
        expect(s.Logger.export().Player[0].message).toEqual(['Player', 'example'])
        expect(s.Socket.send).not.toHaveBeenCalled()
    })

    it('requires explicit telemetry opt-in for automatic remote-console forwarding', ()=>{
        const s = setupConsole({cubTelemetryEnabled: true})
        s.console.log('Player', 'example')
        expect(s.Socket.send).toHaveBeenCalledWith('terminal_console', expect.objectContaining({name: 'Player'}))
    })

    it('keeps the per-category local log buffer bounded', ()=>{
        const s = setupConsole()
        for(let i = 0; i < 250; i++) s.console.log('Player', String(i))
        expect(s.Logger.export().Player).toHaveLength(200)
        expect(s.Socket.send).not.toHaveBeenCalled()
    })
})
