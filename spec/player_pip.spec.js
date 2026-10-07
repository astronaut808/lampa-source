import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import Subscribe from '../src/utils/subscribe'
import * as Observer from '../src/utils/playback_observer'

// Execute the real modules with isolated browser/platform boundaries. No player
// functions are extracted or replaced by copies of the implementation.
function loadModule(path, globals, overrides){
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
    const bindings = {}
    for(const match of source.matchAll(/^import (\w+) from .+$/gm)){
        bindings[match[1]] = {
            init: vi.fn(), render: ()=>node(), listener: Subscribe()
        }
    }
    const code = source.replace(/^import [\s\S]*? from ['"][^'"]+['"]\s*$/gm, '')
        .replace('export default', 'globalThis.moduleResult =')
    const context = {...globals, ...bindings, ...overrides}
    vm.runInNewContext(code, context, {filename: path})
    return context.moduleResult
}

function node(){
    const result = {attached: false, children: []}
    for(const name of ['on', 'attr', 'toggleClass', 'removeClass', 'addClass', 'css', 'text']){
        result[name] = vi.fn(()=>result)
    }
    result.find = ()=>node()
    result.append = vi.fn(child=>{result.children.push(child);child.attached = true;return result})
    result.empty = vi.fn(()=>{result.children = [];return result})
    result.detach = vi.fn(()=>{result.attached = false;return result})
    result.parent = ()=>({length: result.attached ? 1 : 0})
    return result
}

function setup({engine = 'native', normalization = false} = {}){
    const root = node(), videoRoot = node(), display = node(), body = node()
    videoRoot.find = selector=>selector === '.player-video__display' ? display : node()
    const videos = [], reports = [], settings = {player_normalization: normalization}
    const document = {
        hidden: false, pictureInPictureElement: null,
        exitPictureInPicture: vi.fn(async()=>{document.pictureInPictureElement = null}),
        createElement: ()=>({set href(value){this.host = new URL(value).host;this.pathname = new URL(value).pathname}})
    }
    const Player = {}, playlist = [{url: 'https://test.invalid/one.mp4'}, {url: 'https://test.invalid/two.mp4'}]
    const Playlist = {init: vi.fn(), listener: Subscribe(), get: ()=>playlist, set: vi.fn()}
    const Platform = {is: ()=>false, macOS: ()=>false, desktop: ()=>false, get: ()=> 'vidaa'}
    const globals = {
        document, Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
        console: {log: vi.fn(), error: vi.fn()},
        navigator: {userAgent: 'Hisense VIDAA test'},
        Lampa: {Listener: Subscribe(), Platform, Activity: {active: ()=>null}},
        Hls: {isSupported: ()=>true}, dashjs: {},
        window: {location: {assign: vi.fn()}},
        XMLHttpRequest: class {
            open(){} setRequestHeader(){}
            send(body){reports.push(JSON.parse(body))}
        }
    }
    const Template = {get: name=>name === 'player' ? root : videoRoot}
    const Storage = {field: key=>settings[key], get: (key, fallback)=>settings[key] ?? fallback, set: vi.fn()}
    const Controller = {add: vi.fn(), toggle: vi.fn(), clear: vi.fn()}
    const TV = {init: vi.fn(), listener: Subscribe(), playning: ()=>false}
    const tube = {register: vi.fn(), verify: src=>src.includes('youtube.com') ? {
        create: callback=>{const box = $('<video>');callback(box[0]);return box}
    } : false}
    const normalizationInstances = []
    function Normalization(){
        const instance = {attach: vi.fn(), destroy: vi.fn()}
        normalizationInstances.push(instance)
        return instance
    }
    function $(value){
        if(value === 'body') return body
        if(typeof value !== 'string' || !value.startsWith('<video')) return node()
        const events = {}
        const video = {
            currentTime: 0, duration: 100, paused: true, ended: false, seeking: false,
            readyState: 4, networkState: 1, videoWidth: 1920, videoHeight: 1080,
            buffered: {length: 1, start: ()=>0, end: ()=>20}, textTracks: [], audioTracks: [],
            canPlayType: ()=> 'probably',
            addEventListener: vi.fn((name, callback)=>{(events[name] ||= []).push(callback)}),
            play: vi.fn(()=>{video.paused = false}), pause: vi.fn(()=>{video.paused = true}),
            load: vi.fn(), removeAttribute: vi.fn(),
            requestVideoFrameCallback: vi.fn(()=>1), cancelVideoFrameCallback: vi.fn(),
            emit: name=>(events[name] || []).slice().forEach(callback=>callback({}))
        }
        videos.push(video)
        return Object.assign(node(), {0: video})
    }
    globals.$ = $
    const hls = {
        destroy: vi.fn(()=>engine === 'hls'), destroyParser: vi.fn(),
        shouldUseProgram: ()=>({use_program: engine === 'hls', hls_native: true}),
        createProgram: vi.fn((src, video, data, callbacks)=>{video.src = src;callbacks.play()}),
        audioTracks: ()=>null, currentLevel: ()=>undefined
    }
    const dash = {
        destroy: vi.fn(()=>engine === 'dash'), audioTracks: ()=>null, currentLevel: ()=>undefined,
        create: vi.fn((src, video)=>{video.src = src})
    }
    const webos = {setup: vi.fn(), destroy: vi.fn(), audioTracks: ()=>null}
    const Video = loadModule('../src/interaction/player/video.js', globals, {
        Template, Storage, Controller, Platform, TV, Player, Tube: tube,
        Subscribe, Normalization, HlsStream: hls, DashStream: dash, WebOSManager: webos
    })
    // Scaling/speed are unrelated platform presentation boundaries.
    Video.size = vi.fn(); Video.speed = vi.fn()
    const Preroll = {show: (data, callback)=>callback()}
    const Timeline = {init: vi.fn(), destroy: vi.fn(), needToContinue: vi.fn(), resetContinue: vi.fn()}
    Object.assign(Player, loadModule('../src/interaction/player.js', globals, {
        Video, Template, Storage, Controller, Platform, TV, Playlist, Preroll, Timeline,
        Info: {init: vi.fn(), render: ()=>node(), loading: vi.fn()},
        Subscribe, Background: {theme: vi.fn()}, Select: {opened: ()=>false},
        Disclaimer: {init: vi.fn(), needs: ()=>false}, Torserver: {toPlayUrl: url=>url},
        Arrays: {isArray: Array.isArray, getKeys: Object.keys},
        InfusePlayer: {normalizePlayData: vi.fn(), resolveUrl: ()=> 'infuse://play', isTorrentStream: ()=>false}
    }))
    Player.init()
    globals.Lampa.Player = Player
    globals.Lampa.PlayerVideo = Video
    const Metrics = loadModule('../src/utils/playback_metrics.js', globals, {
        Manifest: {app_version: '3.3.4'}, CustomConfig: {playbackMetricsEnabled: true},
        ...Observer, mediaSample: Observer.sample
    })
    Metrics.init()
    const extension = engine === 'hls' ? 'm3u8' : engine === 'dash' ? 'mpd' : 'mp4'
    const first = {url: 'https://test.invalid/one.' + extension, title: 'Episode one'}
    const second = {url: 'https://test.invalid/two.' + extension, title: 'Episode two'}
    function start(){Player.play(first);Video.video().emit('playing')}
    function next(){Playlist.listener.send('select', {item: second})}
    return {Player, Video, Playlist, document, root, display, body, videos, reports, Preroll, Platform,
        hls, dash, tube, settings, globals, normalizationInstances, start, next, second}
}

beforeEach(()=>vi.useFakeTimers())
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})

describe('PiP episode transitions', ()=>{
    it.each(['native', 'hls', 'dash'])('retains video/DOM and rebuilds only the stream engine: %s', engine=>{
        const s = setup({engine})
        s.start()
        const video = s.Video.video(), bindings = video.addEventListener.mock.calls.length
        s.document.pictureInPictureElement = video
        s.hls.destroy.mockClear(); s.dash.destroy.mockClear()
        s.next()
        expect(s.Video.video()).toBe(video)
        expect(s.videos).toHaveLength(1)
        expect(video.src).toContain('/two.')
        expect(video.addEventListener).toHaveBeenCalledTimes(bindings)
        expect(s.root.attached).toBe(true)
        expect(s.body.append).toHaveBeenCalledTimes(1)
        expect(s.document.exitPictureInPicture).not.toHaveBeenCalled()
        if(engine === 'hls') expect(s.hls.createProgram).toHaveBeenCalledTimes(2)
        if(engine === 'dash') expect(s.dash.create).toHaveBeenCalledTimes(2)
        expect(s.hls.destroy).toHaveBeenCalledTimes(1)
        expect(s.dash.destroy).toHaveBeenCalledTimes(engine === 'native' ? 2 : 1)
        s.Player.close()
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.root.attached).toBe(false)
        expect(s.display.children).toHaveLength(0)
    })

    it('keeps ordinary playback on a new video element when PiP is inactive', ()=>{
        const s = setup()
        s.start(); s.next()
        expect(s.videos).toHaveLength(2)
        expect(s.videos[0].removeAttribute).toHaveBeenCalledWith('src')
        expect(s.root.attached).toBe(true)
        expect(s.body.append).toHaveBeenCalledTimes(2)
    })

    it('preserves normalization for the retained video and releases it on close', ()=>{
        const s = setup({normalization: true})
        s.start(); s.document.pictureInPictureElement = s.Video.video(); s.next()
        expect(s.normalizationInstances).toHaveLength(1)
        expect(s.normalizationInstances[0].attach).toHaveBeenCalledTimes(1)
        expect(s.normalizationInstances[0].destroy).not.toHaveBeenCalled()
        s.Player.close()
        expect(s.normalizationInstances[0].destroy).toHaveBeenCalledTimes(1)
    })

    it('cleans the retained video when a plugin aborts the next episode', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        const abort = event=>event.abort()
        s.Player.listener.follow('create', abort)
        s.next()
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.root.attached).toBe(false)
        expect(s.display.children).toHaveLength(0)
        expect(s.reports.at(-1).outcome).toBe('closed')
        s.Player.listener.remove('create', abort)
        s.Player.play({url: 'https://test.invalid/retry.mp4'})
        expect(s.videos).toHaveLength(2)
    })

    it.each(['external', 'destroy'])('cleans a deferred transition on %s and ignores its late callback', event=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        let continueLaunch
        s.Preroll.show = (data, callback)=>{continueLaunch = callback}
        s.next()
        expect(s.document.exitPictureInPicture).not.toHaveBeenCalled()
        expect(s.root.attached).toBe(true)
        s.Player.listener.send(event, {})
        continueLaunch()
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.videos).toHaveLength(1)
        expect(s.display.children).toHaveLength(0)
        expect(s.root.attached).toBe(false)
    })

    it('cleans the retained video when the next episode uses an external player', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.Platform.macOS = ()=>true
        s.settings.player = 'infuse'
        s.next()
        expect(s.globals.window.location.assign).toHaveBeenCalledWith('infuse://play')
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.root.attached).toBe(false)
        expect(s.reports.at(-1).outcome).toBe('external')
    })

    it('ignores a delayed episode callback after the user closes the player', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        let continueLaunch
        s.Preroll.show = (data, callback)=>{continueLaunch = callback}
        s.next(); s.Player.close(); continueLaunch()
        expect(s.videos).toHaveLength(1)
        expect(s.root.attached).toBe(false)
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
    })

    it('retains the same video through repeated episode changes without duplicate handlers', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        const bindings = s.Video.video().addEventListener.mock.calls.length
        s.next(); s.next(); s.next()
        expect(s.videos).toHaveLength(1)
        expect(s.Video.video().addEventListener).toHaveBeenCalledTimes(bindings)
        expect(s.body.append).toHaveBeenCalledTimes(1)
        expect(s.document.exitPictureInPicture).not.toHaveBeenCalled()
    })

    it('retains PiP after a playlist resolver supplies the next episode URL', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        const resolved = s.second.url
        s.second.url = callback=>{s.second.url = resolved;callback()}
        s.next()
        expect(s.videos).toHaveLength(1)
        expect(s.Video.video().src).toBe(resolved)
        expect(s.document.exitPictureInPicture).not.toHaveBeenCalled()
    })

    it('cleans a retained transition after a synchronous stream initialization failure', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        let continueLaunch
        s.Preroll.show = (data, callback)=>{continueLaunch = callback}
        s.next()
        s.Video.url = ()=>{throw new Error('Engine init failed')}
        expect(()=>continueLaunch()).toThrow('Engine init failed')
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.root.attached).toBe(false)
        expect(s.reports.at(-1).outcome).toBe('closed')
    })

    it.each(['close', 'external'])('does not resurrect video after reentrant %s during start', action=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.Player.listener.follow('start', ()=>{
            if(action === 'close') s.Player.close()
            else s.Player.listener.send('external', {})
        })
        s.next()
        expect(s.videos).toHaveLength(1)
        expect(s.display.children).toHaveLength(0)
        expect(s.root.attached).toBe(false)
        expect(s.Player.opened()).toBe(false)
    })

    it('does not resurrect video after a plugin closes the player during create', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.Player.listener.follow('create', ()=>s.Player.close())
        s.next()
        expect(s.videos).toHaveLength(1)
        expect(s.root.attached).toBe(false)
        expect(s.Player.opened()).toBe(false)
    })

    it.each(['quality', 'plugin'])('releases retained native video if %s changes the effective URL to Tube', source=>{
        const s = setup({normalization: true})
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        if(source === 'quality'){
            s.settings.video_quality_default = 1080
            s.second.quality = {'480p': s.second.url, '1080p': 'https://youtube.com/watch?v=test'}
        }
        else s.Player.listener.follow('start', data=>{data.url = 'https://youtube.com/watch?v=test'})
        s.next()
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.display.children).toHaveLength(1)
        expect(s.normalizationInstances[0].destroy).toHaveBeenCalledTimes(1)
        expect(s.root.attached).toBe(true)
        expect(s.Video.video()).not.toBe(s.videos[0])
    })

    it('does not overwrite or destroy a replacement launch from an engine listener', ()=>{
        const s = setup({normalization: true})
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        let replaced = false
        s.Video.listener.follow('astronaut:engine', ()=>{
            if(replaced) return
            replaced = true
            s.Player.play({url: 'https://test.invalid/replacement.mp4', title: 'Replacement'})
        })
        s.next()
        expect(s.Video.video().src).toBe('https://test.invalid/replacement.mp4')
        expect(s.Video.video().paused).toBe(false)
        expect(s.Player.playdata().title).toBe('Replacement')
        expect(s.Player.opened()).toBe(true)
        expect(s.root.attached).toBe(true)
        expect(s.display.children).toHaveLength(1)
        expect(s.normalizationInstances[0].destroy).toHaveBeenCalledTimes(1)
        expect(s.normalizationInstances[1].attach).toHaveBeenCalledTimes(1)
    })

    it('cleans malformed effective URLs without leaving retained PiP or normalization', ()=>{
        const s = setup({normalization: true})
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.Player.listener.follow('start', data=>{data.url = null})
        const error = vi.spyOn(console, 'error').mockImplementation(()=>{})
        try{
            s.next()
            expect(error).toHaveBeenCalled()
            expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
            expect(s.root.attached).toBe(false)
            expect(s.normalizationInstances[0].destroy).toHaveBeenCalledTimes(1)
        }
        finally{error.mockRestore()}
    })

    it('does not continue loading after the player is closed by an engine listener', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.Video.listener.follow('astronaut:engine', ()=>s.Player.close())
        s.next()
        expect(s.root.attached).toBe(false)
        expect(s.display.children).toHaveLength(0)
        expect(s.Video.video().paused).toBe(true)
        expect(s.Player.opened()).toBe(false)
    })

    it.each(['load', 'play'])('does not resume playback after close from the %s command listener', action=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.Video.listener.follow('astronaut:command', data=>{
            if(data.action === action) s.Player.close()
        })
        s.next()
        expect(s.root.attached).toBe(false)
        expect(s.display.children).toHaveLength(0)
        expect(s.Video.video().paused).toBe(true)
        expect(s.Player.opened()).toBe(false)
    })

    it.each(['load', 'play'])('does not overwrite replacement playback from the %s command listener', action=>{
        const s = setup({normalization: true})
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        let replaced = false
        s.Video.listener.follow('astronaut:command', data=>{
            if(replaced || data.action !== action) return
            replaced = true
            s.Player.play({url: 'https://test.invalid/replacement.mp4', title: 'Replacement'})
        })
        s.next()
        expect(s.Video.video().src).toBe('https://test.invalid/replacement.mp4')
        expect(s.Video.video().paused).toBe(false)
        expect(s.Player.playdata().title).toBe('Replacement')
        expect(s.root.attached).toBe(true)
        expect(s.display.children).toHaveLength(1)
        expect(s.normalizationInstances[0].destroy).toHaveBeenCalledTimes(1)
    })

    it('starts separate metric attempts and cancels the old frame observer when reusing video', ()=>{
        const s = setup()
        s.start(); vi.advanceTimersByTime(1000)
        s.document.pictureInPictureElement = s.Video.video(); s.next()
        s.Video.video().emit('playing')
        const closed = s.reports.find(report=>report.outcome === 'closed')
        const playing = s.reports.filter(report=>report.outcome === 'playing').at(-1)
        expect(closed).toBeTruthy()
        expect(playing.attempt_id).not.toBe(closed.attempt_id)
        expect(playing.diagnostics.recent_samples[0].at_ms).toBe(0)
        expect(s.Video.video().cancelVideoFrameCallback).toHaveBeenCalledTimes(1)
        expect(s.Video.video().requestVideoFrameCallback).toHaveBeenCalledTimes(2)
    })

    it('does not keep PiP for a tube-plugin source', ()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.second.url = 'https://youtube.com/watch?v=test'
        s.next()
        expect(s.document.exitPictureInPicture).toHaveBeenCalledTimes(1)
        expect(s.display.empty).toHaveBeenCalledTimes(1)
    })

    it('handles a browser rejection when closing PiP', async()=>{
        const s = setup()
        s.start(); s.document.pictureInPictureElement = s.Video.video()
        s.document.exitPictureInPicture.mockRejectedValueOnce(new Error('Already closed'))
        s.Player.close()
        await Promise.resolve()
        expect(s.display.children).toHaveLength(0)
        expect(s.root.attached).toBe(false)
    })
})
