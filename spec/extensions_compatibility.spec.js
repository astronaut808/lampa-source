import {describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'

function setup(runtime = {}, params = {}){
    const CustomConfig = loadBrowserModule('src/custom/config.js', {window: {LampaRuntimeConfig: runtime}})
    const nodes = new Map()
    const html = {
        querySelector(selector){
            if(!nodes.has(selector)) nodes.set(selector, {classList: {remove: vi.fn(), add: vi.fn()}, innerText: ''})
            return nodes.get(selector)
        },
        style: {}
    }
    class Item {
        constructor(data, options){this.data = data; this.params = options; this.html = html}
        update(){}
    }
    const network = {silent: vi.fn()}
    const Plugins = {get: ()=>[], add: vi.fn(), save: vi.fn(), push: vi.fn()}
    const Account = {Api: {pluginToggle: vi.fn()}}
    const Select = {show: vi.fn()}
    const Extension = loadBrowserModule('src/interaction/extensions/extension.js', {
        Item, CustomConfig, Plugins, Account, Select,
        Reguest: class {constructor(){return network}},
        UtilsOther: {protocol: ()=> 'https://'}, Manifest: {cub_domain: 'cub.example'},
        Lang: {translate: key=>key}, Controller: {enabled: ()=>({name: 'extensions'}), toggle: vi.fn()},
        Noty: {show: vi.fn()}
    })
    const extension = new Extension({id: 5, link: 'http://192.168.1.101:9118/online.js', name: 'Astro', author: 'local', install: 10}, {cub: true, type: 'extensions', ...params})
    function choose(action){
        extension.menu()
        const options = Select.show.mock.calls.at(-1)[0]
        options.onSelect(options.items.find(item=>item[action]))
    }
    return {Extension, extension, choose, network, Plugins, Account, Select, html}
}

describe('extensions privacy and compatibility', ()=>{
    it.each([undefined, false, 'false', 'true', 1])('installs a CUB catalog extension without statistics when telemetry is %s', value=>{
        const s = setup({cubTelemetryEnabled: value})
        s.choose('install')
        expect(s.Plugins.add).toHaveBeenCalledWith(expect.objectContaining({url: 'http://192.168.1.101:9118/online.js', status: 1}))
        expect(s.network.silent).not.toHaveBeenCalled()
        expect(s.extension.data.install).toBe(10)
    })

    it('also protects the direct statistics method and completes its callback', ()=>{
        const s = setup()
        const done = vi.fn()
        s.extension.installSend(5, done)
        expect(done).toHaveBeenCalledOnce()
        expect(done).toHaveBeenCalledWith(false)
        expect(s.network.silent).not.toHaveBeenCalled()
    })

    it('retains an explicit opt-in positive control without coupling installation to its result', ()=>{
        const s = setup({cubTelemetryEnabled: true})
        s.choose('install')
        expect(s.Plugins.add).toHaveBeenCalledOnce()
        expect(s.network.silent).toHaveBeenCalledWith('https://cub.example/api/extensions/install', expect.any(Function), expect.any(Function), {id: 5})
        s.network.silent.mock.calls[0][2]()
        expect(s.extension.data.install).toBe(10)
    })

    it('keeps CUB plugin synchronization when telemetry is disabled', ()=>{
        const s = setup({}, {type: 'plugins'})
        s.choose('toggle')
        expect(s.Account.Api.pluginToggle).toHaveBeenCalledWith(s.extension.data, 1)
        expect(s.Plugins.push).toHaveBeenCalledWith(s.extension.data)
        expect(s.network.silent).not.toHaveBeenCalled()
    })

    it('keeps user-installed extensions editable and does not send install statistics for them', ()=>{
        const s = setup({cubTelemetryEnabled: true}, {cub: false, type: 'installs'})
        s.extension.menu()
        const options = s.Select.show.mock.calls[0][0]
        expect(options.items.some(item=>item.change === 'url')).toBe(true)
        expect(options.items.some(item=>item.remove)).toBe(true)
        expect(s.network.silent).not.toHaveBeenCalled()
    })

    it('never hides extensions because of their region, while preserving platform compatibility', ()=>{
        const Line = loadBrowserModule('src/interaction/extensions/line.js', {
            Platform: {is: name=>name === 'vidaa'},
            window: {lampa_settings: {account_use: true}}, VPN: {code: ()=> 'ru'}
        })
        const entries = [
            {id: 1, region: 'ru'}, {id: 2, region: 'us'}, {id: 3, region: 'all'},
            {id: 4}, {id: 5, region: 'us', platform: 'vidaa'}, {id: 6, platform: 'webos'}
        ]
        const line = new Line(entries, {})
        line.append = vi.fn()
        line.display(4)
        expect(line.append.mock.calls.map(([item])=>item.id)).toEqual([1, 2, 3, 4, 5])
    })

    it.each(['localhost', '192.168.1.101', 'lampa.astro.home'])('does not auto-load Engineer or Shots at %s and retains eager media libraries', hostname=>{
        const include = vi.fn()
        const CustomConfig = loadBrowserModule('src/custom/config.js', {window: {}})
        const Libs = loadBrowserModule('src/services/libs.js', {
            CustomConfig, Manifest: {cub_domain: 'cub.example'},
            window: {location: {hostname, protocol: 'http:', href: 'http://' + hostname}, lampa_settings: {services: false}},
            Utils: {protocol: ()=> 'http://', putScriptAsync: include}
        })
        Libs.init()
        expect(include).toHaveBeenCalledOnce()
        expect(include.mock.calls[0][0]).toEqual(['./vender/hls/hls.js', './vender/dash/dash.js', './vender/qrcode/qrcode.js'])
    })
})
