import { expect, suite, test, vi } from 'vitest'
import {
    canShowBuiltinPreroll,
    shouldInitializeBuiltinAds
} from '../src/custom/advertising_policy'
import fs from 'node:fs'
import {loadBrowserModule} from './helpers/browser_module'

const banner = fs.readFileSync(new URL('../src/interaction/advert/banner.js', import.meta.url), 'utf8')

suite('custom advertising policy', () => {
    const states = [
        {name: 'regular video', excludedMedia: false},
        {name: 'IPTV', excludedMedia: true},
        {name: 'torrent', excludedMedia: true},
        {name: 'premium account', excludedMedia: false, hasPremium: true},
        {name: 'personal confirmation', excludedMedia: false, personalConfirmed: true},
        {name: 'developer ads setting', excludedMedia: false, developerAdsEnabled: true}
    ]

    states.forEach(({name, ...state}) => {
        test(`disables preroll for ${name}`, () => {
            expect(canShowBuiltinPreroll({
                developerAdsEnabled: false,
                hasPremium: false,
                personalConfirmed: false,
                ...state
            })).toBe(false)
        })
    })

    test('does not initialize the built-in advertising manager', () => {
        expect(shouldInitializeBuiltinAds()).toBe(false)
    })

    test('blocks plugin VAST banners before any advertising manager starts', () => {
        expect(banner).toContain("import { shouldInitializeBuiltinAds } from '../../custom/advertising_policy'")
        expect(banner).toMatch(/function init\(\)\{\s*[^]*if\(!shouldInitializeBuiltinAds\(\)\) return/)
        expect(banner.indexOf('if(!shouldInitializeBuiltinAds()) return')).toBeLessThan(banner.indexOf('Manager.init()'))
    })

    test('bypasses preroll before media inspection, targeting, SDK or VAST lookup', ()=>{
        const call = vi.fn()
        const inspect = vi.fn(()=>({any: false}))
        const get = vi.fn(), metric = vi.fn(), region = vi.fn()
        const Preroll = loadBrowserModule('src/interaction/advert/preroll.js', {
            shouldInitializeBuiltinAds,
            VastManager: class {init = vi.fn(); get = get; coolingReady = ()=>true},
            IMA: {getMediaType: inspect, canShow: ()=>false, loadSDK: vi.fn()},
            Metric: {counter: metric}, VPN: {code: region},
            Account: {hasPremium: ()=>false}, Personal: {confirm: ()=>false},
            console: {log: vi.fn()}
        })
        const data = {url: 'https://video.example/stream.m3u8', vast_url: 'https://ads.example/vast', vast_banner: 'https://ads.example/banner'}
        Preroll.show(data, call)
        expect(call).toHaveBeenCalledTimes(1)
        expect(inspect).not.toHaveBeenCalled()
        expect(get).not.toHaveBeenCalled()
        expect(metric).not.toHaveBeenCalled()
        expect(region).not.toHaveBeenCalled()
        expect(data).not.toHaveProperty('ad_region')
    })

    test('refuses IMA ads without inspecting a plugin-provided URL', ()=>{
        const inspect = vi.fn(()=>{throw new Error('URL inspection must be skipped')})
        const IMA = loadBrowserModule('src/interaction/advert/ima.js', {
            canShowBuiltinPreroll, shouldInitializeBuiltinAds,
            Torserver: {ip: ()=> 'server.example'},
            Account: {hasPremium: vi.fn()}, Personal: {confirm: vi.fn()}
        })
        expect(()=>IMA.canShow({torrent_hash: 'torrent', get url(){return inspect()}})).not.toThrow()
        expect(IMA.canShow({url: ()=>{}})).toBe(false)
        expect(inspect).not.toHaveBeenCalled()
    })

    test('does not initialize banner/preroll managers or request personal.lampa', ()=>{
        const init = vi.fn(), follow = vi.fn(), add = vi.fn(), ajax = vi.fn()
        const globals = {
            shouldInitializeBuiltinAds,
            VastManager: class {init = init}, Timer: {add},
            Lampa: {Player: {listener: {follow}}}, $: {ajax}
        }
        loadBrowserModule('src/interaction/advert/preroll.js', globals).init()
        loadBrowserModule('src/interaction/advert/banner.js', globals).init()
        loadBrowserModule('src/core/personal.js', globals).init()
        expect(init).not.toHaveBeenCalled()
        expect(follow).not.toHaveBeenCalled()
        expect(add).not.toHaveBeenCalled()
        expect(ajax).not.toHaveBeenCalled()
    })

    test('retains explicit runtime opt-in as a positive control', ()=>{
        const CustomConfig = loadBrowserModule('src/custom/config.js', {
            window: {LampaRuntimeConfig: {builtinAdsEnabled: true}}
        })
        const policy = loadBrowserModule('src/custom/advertising_policy.js', {CustomConfig})
        const init = vi.fn()
        const Preroll = loadBrowserModule('src/interaction/advert/preroll.js', {
            ...policy, VastManager: class {init = init}
        })
        expect(policy.canShowBuiltinPreroll({excludedMedia: false, developerAdsEnabled: false, hasPremium: false, personalConfirmed: false})).toBe(true)
        Preroll.init()
        expect(init).toHaveBeenCalledTimes(1)
    })
})
