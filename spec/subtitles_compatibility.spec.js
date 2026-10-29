import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'
import Subscribe from '../src/utils/subscribe'

afterEach(()=>vi.useRealTimers())

function subtitles(autostart = false){
    const loads = [], instances = []
    const video = {addEventListener: vi.fn(), removeEventListener: vi.fn()}
    const Player = {listener: Subscribe()}, Video = {listener: Subscribe(), video: ()=>video, render: ()=>({})}
    const hide = vi.fn(), show = vi.fn(), Panel = {listener: Subscribe()}
    const node = {addClass(){return this}, removeClass(){return this}}
    const module = loadBrowserModule('src/interaction/player/subtitles.js', {
        Player, Video, Panel, Playlist: {listener: Subscribe()}, PanelSettings: {listener: Subscribe()},
        Cue: {render: ()=>node, draw: vi.fn()},
        CustomSubtitles: class {
            constructor(){this.listener = Subscribe();this.load = vi.fn();this.destroy = vi.fn();this.reset = vi.fn();instances.push(this)}
        },
        Storage: {field: key=>key === 'subtitles_start' && autostart, get: (k, fallback)=>fallback}, Lang: {translate: x=>x}, Noty: {show: vi.fn()},
        Arrays: {isArray: Array.isArray, clone: x=>JSON.parse(JSON.stringify(x))},
        TorserverSubs: {available: ()=>true, load: (data, done, fail)=>{const r={done,fail,destroy:vi.fn()};loads.push(r);return r}},
        AssSubtitles: {hide, show, enabled: ()=>true}, preferredSubtitle: subs=>autostart ? subs[0] : null, console: {log: vi.fn()}, Date
    })
    module.init()
    const ready = (custom = true)=>Player.listener.send('ready', {torrent_hash: 'hash', url: 'http://server/stream?index=1',
        subtitles: custom ? [{label: 'Manual', url: 'manual.vtt'}] : undefined})
    return {module, Player, Panel, ready, video, loads, instances, hide, show}
}

describe('asynchronous subtitle lists', ()=>{
    it.each([false,true])('preserves an explicit native/Off choice without initial custom subtitles: %s', selected=>{
        const s = subtitles(true)
        s.ready(false)
        s.video.textTracks = [{mode: selected ? 'showing' : 'disabled'}]
        s.Panel.listener.send('subsview', {status:selected})
        s.loads[0].done([{label:'External',url:'external.vtt'}])
        expect(s.instances).toHaveLength(0)
        expect(s.video.textTracks[0].mode).toBe(selected ? 'showing' : 'disabled')
    })
    it('does not replace a manually selected track with a late TorrServer list', ()=>{
        const s = subtitles()
        s.ready()
        s.video.customSubs[0].mode = 'showing'
        s.Panel.listener.send('subsview', {status:true})
        expect(s.instances[0].load).toHaveBeenCalledWith('manual.vtt')
        s.loads[0].done([{label: 'Server', url: 'server.vtt'}])
        expect(s.instances[0].destroy).not.toHaveBeenCalled()
        expect(s.video.customSubs[0].mode).toBe('showing')
        expect(s.video.customSubs[0].url).toBe('manual.vtt')
    })
    it('preserves an explicit disabled choice', ()=>{
        const s = subtitles()
        s.ready()
        s.video.customSubs[0].mode = 'disabled'
        s.Panel.listener.send('subsview', {status:false})
        s.loads[0].done([{label: 'Server', url: 'server.vtt'}])
        expect(s.instances).toHaveLength(1)
        expect(s.instances[0].load).not.toHaveBeenCalled()
    })
    it('accepts a late list if no selection has changed', ()=>{
        const s = subtitles()
        s.ready()
        s.loads[0].done([{label: 'Server', url: 'server.vtt'}])
        expect(s.video.customSubs[0].url).toBe('server.vtt')
        expect(s.instances[0].destroy).toHaveBeenCalledOnce()
    })
    it('does not mistake automatic loadedmetadata selection for a user choice', ()=>{
        const s = subtitles(true)
        s.ready()
        // Video.loaded() restores/defaults modes without a Panel user event.
        s.video.customSubs.forEach(sub=>{sub.mode='disabled';sub.selected=false})
        s.video.customSubs[0].mode='showing'
        s.loads[0].done([{label:'Server',url:'server.vtt'}])
        expect(s.video.customSubs[0].url).toBe('server.vtt')
        expect(s.video.customSubs[0].mode).toBe('showing')
    })
    it('ignores old lists after close and removes native listeners on retained video', ()=>{
        const s = subtitles()
        s.ready()
        s.Player.listener.send('destroy', {keep_pip: true})
        expect(s.loads[0].destroy).toHaveBeenCalledOnce()
        expect(s.video.removeEventListener).toHaveBeenCalledOnce()
        s.ready()
        s.loads[0].done([{url: 'old.vtt'}])
        expect(s.video.customSubs[0].url).toBe('manual.vtt')
        expect(s.video.addEventListener).toHaveBeenCalledTimes(2)
    })
})

function jassub({ua = 'Chrome/128', missingModern = false, invalidMime = false, hungScript = false, hungWorker = false} = {}){
    const created = [], fail = vi.fn(), scripts = vi.fn()
    class Renderer {
        constructor(){this.handlers={};this._worker={addEventListener:vi.fn()};this.destroy=vi.fn();created.push(this)}
        addEventListener(name, fn){this.handlers[name]=fn}
    }
    const fetch = vi.fn(async url=>({ok: !(missingModern && url.endsWith('-modern.wasm')), status:404,
        text: ()=>hungWorker ? new Promise(()=>{}) : Promise.resolve('worker'),
        headers:{get: ()=>invalidMime?'text/html':'application/wasm'}}))
    const module = loadBrowserModule('src/interaction/player/subtitles/ass/jassub.js', {
        navigator: {userAgent: ua}, document: {baseURI: 'http://localhost:8090/',createElement:()=>({}),
            body:{appendChild:script=>{scripts(script.src);if(!hungScript)script.onload()}}},
        window: {location: {origin:'http://localhost:8090',protocol:'http:',href:'http://localhost:8090/'},JASSUB:Renderer},
        Storage:{get:(key,fallback)=>hungWorker && key === 'jassub_path' ? 'https://custom.example/' : fallback,set:vi.fn()}, Manifest:{github_lampa:'https://remote.example/'},
        Platform:{tv:()=>false,chromeVersion:()=>ua.includes('128')?128:88},
        WebAssembly, Worker:class {},fetch,Blob,URL,AbortController,
        setTimeout,clearTimeout,setInterval,clearInterval,Promise,console:{log:vi.fn()}
    })
    return {module, created, fail, fetch, scripts}
}

describe('lazy ASS platform and failure policy', ()=>{
    it.each([{hungScript:true},{hungWorker:true}])('bounds script and worker body loading: %j', async options=>{
        vi.useFakeTimers()
        const s=jassub(options)
        const renderer=s.module.create({video:{},onFail:s.fail})
        renderer.load('ASS text')
        await vi.advanceTimersByTimeAsync(12001)
        expect(s.fail).toHaveBeenCalledOnce()
        expect(s.created).toHaveLength(0)
        renderer.destroy()
        expect(vi.getTimerCount()).toBe(0)
    })
    it('does not create a renderer after its total loading deadline', async()=>{
        vi.useFakeTimers()
        const s=jassub()
        let fontsReady
        const fonts={fonts:[],done:new Promise(resolve=>{fontsReady=resolve}),on:vi.fn()}
        const renderer=s.module.create({video:{},fonts,onFail:s.fail})
        renderer.load('ASS text')
        renderer.destroy()
        fontsReady()
        await vi.advanceTimersByTimeAsync(12001)
        expect(s.created).toHaveLength(0)
        expect(s.fail).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })
    it.each(['VIDAA/6.0 Chrome/88', 'Hisense Chrome/88', 'Odin/88'])('keeps full rendering opt-in for %s', ua=>{
        const s=jassub({ua})
        expect(s.module.supported(false)).toBe(false)
        expect(s.module.supported(true)).toBe(true)
        expect(s.fetch).not.toHaveBeenCalled()
        expect(s.scripts).not.toHaveBeenCalled()
    })
    it('keeps normal HTTP builds local and still permits a desktop renderer', ()=>{
        const s=jassub()
        expect(s.module.candidates()).toEqual(['http://localhost:8090/vender/jassub/'])
        expect(s.module.supported(false)).toBe(true)
    })
    it.each([{missingModern:true},{invalidMime:true}])('falls back when asset verification fails: %j', async options=>{
        vi.useFakeTimers()
        const s=jassub(options)
        s.module.create({video:{},onFail:s.fail}).load('ASS text')
        await vi.advanceTimersByTimeAsync(1)
        expect(s.fail).toHaveBeenCalledOnce()
        expect(s.created).toHaveLength(0)
    })
    it('fails once and destroys the worker when readiness never arrives', async()=>{
        vi.useFakeTimers()
        const s=jassub()
        const renderer=s.module.create({video:{},onFail:s.fail})
        renderer.load('ASS text')
        await vi.advanceTimersByTimeAsync(1)
        expect(s.created).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(8000)
        expect(s.fail).toHaveBeenCalledOnce()
        expect(s.created[0].destroy).toHaveBeenCalledOnce()
        renderer.destroy()
        expect(vi.getTimerCount()).toBe(0)
    })
    it('cancels readiness checks on ready or close', async()=>{
        vi.useFakeTimers()
        const s=jassub()
        const renderer=s.module.create({video:{},onFail:s.fail})
        renderer.load('ASS text')
        await vi.advanceTimersByTimeAsync(1)
        s.created[0].handlers.ready()
        await vi.advanceTimersByTimeAsync(9000)
        expect(s.fail).not.toHaveBeenCalled()
        renderer.destroy()
        expect(vi.getTimerCount()).toBe(0)
    })
})
