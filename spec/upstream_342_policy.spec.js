import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'
import Subscribe from '../src/utils/subscribe'

afterEach(()=>vi.useRealTimers())

function config(runtime = {}){
    return loadBrowserModule('src/custom/config.js', {window: {LampaRuntimeConfig: runtime}})
}

describe('optional upstream services', ()=>{
    it.each([undefined, false, 'true', 'false', 1])('requires literal opt-in for new automatic services: %s', value=>{
        const c = config({seasonalEventsEnabled: value, postPlaybackReactionsEnabled: value})
        expect(c.seasonalEventsEnabled).toBe(false)
        expect(c.postPlaybackReactionsEnabled).toBe(false)
    })

    it.each(['2026-10-27', '2026-11-27', '2026-12-25', '2027-01-02'])('does not load seasonal ads at %s', date=>{
        vi.useFakeTimers().setSystemTime(new Date(date + 'T12:00:00'))
        const scripts = vi.fn()
        const run = runtime=>loadBrowserModule('src/services/events.js', {
            Date, CustomConfig: config(runtime), window: {lampa_settings: {services: true}},
            Manifest: {cub_domain: 'cub.example'}, Utils: {protocol: ()=> 'https://', putScriptOfMirrors: scripts}
        }).init()
        run({})
        run({seasonalEventsEnabled: true})
        run({builtinAdsEnabled: true})
        expect(scripts).not.toHaveBeenCalled()
        run({seasonalEventsEnabled: true, builtinAdsEnabled: true})
        expect(scripts).toHaveBeenCalledOnce()
        expect(scripts.mock.calls[0][0].length).toBeGreaterThan(0)
    })
})

function reactions(enabled){
    const player = {listener: Subscribe(), opened: ()=>false}
    const values = {}, requests = [], title = vi.fn(), modal = vi.fn()
    const node = {0: {}, length: 1, find(){return this}, each(){}, eq(){return this},
        removeClass(){return this}, addClass(){return this}, attr: ()=>'',
        text(value){title(value);return this}, on(){return this}, append(){return this}}
    const Storage = {field: ()=>true, get: (k, fallback)=>values[k] ?? fallback, set: (k,v)=>{values[k] = v}}
    const vote = vi.fn()
    const module = loadBrowserModule('src/interaction/player/reaction.js', {
        CustomConfig: config({postPlaybackReactionsEnabled: enabled}),
        Player: player, Video: {verifyTube: ()=>false}, Storage,
        Controller: {enabled: ()=>({name: 'content'}), toggle: vi.fn()},
        Activity: {active: ()=>({})},
        Api: {sources: {tmdb: {seasons: (...args)=>requests.push(args)}, cub: {reactionsAdd: vote}}},
        Arrays: {isArray: Array.isArray, getKeys: Object.keys},
        Template: {get: ()=>node}, Lang: {translate: key=>key}, Modal: {open: modal, close: vi.fn()},
        Manifest: {cub_domain: 'cub.example'}, Utils: {protocol: ()=> 'https://'},
        Bell: {push: vi.fn()}, Noty: {show: vi.fn()},
        $: value=>value === '.reaction-ask' ? {length: 0} : node,
        window: {lampa_settings: {disable_features: {}}}, Date, setTimeout, clearTimeout
    })
    module.init()
    const close = (id, tv = false)=>player.listener.send('close', {data: {
        url: 'https://video.example/stream.m3u8', timeline: {percent: 95, season: 1, episode: 1},
        card: tv ? {id, original_name: 'Series'} : {id, title: 'Movie'}
    }})
    return {player, requests, values, title, modal, vote, close}
}

describe('post-playback reaction policy and cancellation', ()=>{
    it('does not issue requests or open a prompt by default', ()=>{
        vi.useFakeTimers()
        const s = reactions(false)
        s.close(1, true)
        vi.runAllTimers()
        expect(s.requests).toHaveLength(0)
        expect(s.modal).not.toHaveBeenCalled()
        expect(s.vote).not.toHaveBeenCalled()
    })

    it('ignores an old season reply after a newer video has been closed', ()=>{
        vi.useFakeTimers()
        const s = reactions(true)
        s.close(1, true)
        expect(s.requests).toHaveLength(1)
        s.player.listener.send('start', {})
        s.close(2)
        s.requests[0][2]({1: {episodes: [{}]}})
        vi.advanceTimersByTime(1600)
        expect(s.modal).toHaveBeenCalledOnce()
        expect(Object.keys(s.values.reaction_asked)).toEqual(['movie_2'])
        expect(s.vote).not.toHaveBeenCalled()
    })

    it('cancels a movie prompt when another playback begins', ()=>{
        vi.useFakeTimers()
        const s = reactions(true)
        s.close(3)
        s.player.listener.send('start', {})
        vi.runAllTimers()
        expect(s.modal).not.toHaveBeenCalled()
    })
})

describe('source selection compatibility', ()=>{
    function setup(android, count = 1){
        const triggered = vi.fn(), saved = vi.fn(), show = vi.fn()
        const button = {trigger: triggered, find: ()=>({prop: ()=>'<svg></svg>'}), text: ()=> 'Astro', data: ()=>'',
            clone(){return this}, removeClass(){return this}, prop: ()=> 'source'}
        const collection = {length: count, not(){return this}, filter(){return this},
            each(fn){for(let i=0;i<count;i++) fn.call(button)}, trigger: triggered}
        const module = loadBrowserModule('src/components/full/start/buttons.js', {
            window: {lampa_settings: {plugins_use: true}}, Platform: {is: n=>android && n === 'android'},
            Storage: {get: ()=>'', set: saved}, Utils: {hash: ()=> 'source'},
            Select: {show}, Lang: {translate: x=>x}, $: x=>x,
            Controller: {toggle: vi.fn()}, Extensions: {}, ParentalControl: {}
        })
        const owner = {html: {find: ()=>collection}, emit: vi.fn()}
        module.onWatch.call(owner, {})
        return {triggered, saved, show}
    }
    it('opens a single source directly on non-Android devices', ()=>{
        const s = setup(false)
        expect(s.triggered).toHaveBeenCalledWith('hover:enter', [{}])
        expect(s.show).not.toHaveBeenCalled()
    })
    it('retains Android add-source without a long-press crash', ()=>{
        const s = setup(true)
        const menu = s.show.mock.calls[0][0]
        expect(menu.items[1].add_source).toBe(true)
        expect(()=>menu.onLong(menu.items[1])).not.toThrow()
        expect(s.saved).not.toHaveBeenCalled()
        menu.onLong(menu.items[0])
        expect(s.saved).toHaveBeenCalledOnce()
    })
})
