import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'
import Arrays from '../src/utils/arrays'

afterEach(()=>vi.useRealTimers())

describe('CUB API request isolation', ()=>{
    function setup(){
        const shared = {silent:vi.fn(),clear:vi.fn()}, scoped = {silent:vi.fn(),clear:vi.fn()}
        const Permit = {token:'test-token',account:{token:'test-token',profile:{id:7}},access:true}
        const api = loadBrowserModule('src/core/account/api.js', {
            Permit,Arrays,Utils:{protocol:()=> 'http://'},Manifest:{cub_domain:'cub.example'},
            Reguest:class {constructor(){return shared}}, Date
        })
        return {api,shared,scoped}
    }
    it('uses a scoped history request without changing account synchronization transport', async()=>{
        const s=setup(), result=vi.fn(), failure=vi.fn()
        s.api.watchHistory({page:2,group:'card',filter:'tv'},result,failure,s.scoped)
        expect(s.shared.silent).not.toHaveBeenCalled()
        const [url,done,,,params]=s.scoped.silent.mock.calls[0]
        expect(url).toContain('/api/history/list?page=2&type=tv&group=card&tz=')
        expect(params.headers).toEqual({token:'test-token',profile:7})
        done({history:[{card:{id:42,name:'Series'},episodes:[{season:1,episode:2}],views:2}],page:2,total_pages:3,total:30})
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({page:2,total:30}))
        expect(failure).not.toHaveBeenCalled()
        s.api.pluginToggle({id:1},1)
        expect(s.shared.silent).toHaveBeenCalledOnce()
        s.scoped.clear()
        expect(s.shared.clear).not.toHaveBeenCalled()
    })
    it('retains the original public API without the optional scoped transport', async()=>{
        const s=setup(), done=vi.fn()
        s.api.watchHistoryCard('tv_42',done)
        expect(s.shared.silent.mock.calls[0][0]).toContain('/api/history/card?card_id=tv_42')
        s.shared.silent.mock.calls[0][1]({history:[]})
        await Promise.resolve()
        expect(done).toHaveBeenCalledWith([])
    })
})

function history(){
    const comp={use:vi.fn(),build:vi.fn(),empty:vi.fn()}
    const scoped={timeout:vi.fn(),silent:vi.fn(),clear:vi.fn()}
    const profile={id:1}, requests=[], fallback=vi.fn()
    const component=loadBrowserModule('src/components/watch_history.js', {
        Utils:{createInstance:()=>comp},Category:{},CategoryModule:{MASK:{base:1},toggle:()=>1},
        CardModule:{MASK:{base:1},toggle:()=>1}, EmptyRouter:{},
        Account:{Permit:{profile},Api:{watchHistory:(...args)=>requests.push(args)}},
        Api:{favorite:fallback},Lang:{translate:x=>x},Reguest:class{constructor(){return scoped}},
        Loading:{stop:vi.fn()}
    })
    component({page:1})
    const hooks=comp.use.mock.calls.map(([module])=>module).find(module=>module.onCreate)
    hooks.onCreate.call(comp)
    return {comp,scoped,profile,requests,fallback,hooks}
}

describe('history compatibility and cancellation', ()=>{
    it.each(['empty','network'])('keeps old history accessible on %s response', outcome=>{
        const s=history()
        if(outcome==='empty') s.requests[0][1]({results:[]})
        else s.requests[0][2]({status:503})
        expect(s.requests[0][3]).toBe(s.scoped)
        expect(s.fallback).toHaveBeenCalledOnce()
        const data={results:[{id:42,title:'Saved'}]}
        s.fallback.mock.calls[0][1](data)
        expect(s.comp.build).toHaveBeenCalledWith(data)
    })
    it('does not resurrect a closed screen or abort other account requests', ()=>{
        const s=history()
        s.hooks.onDestroy()
        s.requests[0][1]({results:[{id:42}]})
        s.requests[0][2]({status:503})
        expect(s.comp.build).not.toHaveBeenCalled()
        expect(s.fallback).not.toHaveBeenCalled()
        expect(s.scoped.clear).toHaveBeenCalledOnce()
    })
    it('ignores replies for an old profile', ()=>{
        const s=history()
        s.profile.id=2
        s.requests[0][1]({results:[]})
        expect(s.fallback).not.toHaveBeenCalled()
        expect(s.comp.empty).not.toHaveBeenCalled()
    })
    it('retains the login state for an unauthorized response', ()=>{
        const s=history()
        s.requests[0][2]({decode_code:403})
        expect(s.comp.empty).toHaveBeenCalledOnce()
        expect(s.fallback).not.toHaveBeenCalled()
    })
})

describe('bookmark parser fallback', ()=>{
    it('keeps valid and recoverable bookmarks when a worker is unavailable', ()=>{
        const module=loadBrowserModule('src/utils/worker.js', {
            navigator:{userAgent:'netcast'},Arrays,BlurWorker:class{},JSONWorker:class{},UtilsWorker:class{}
        })
        const done=vi.fn()
        module.utils({type:'account_bookmarks_parse',data:[
            {data:'{broken',card_id:'42',card_type:'tv',card_title:'Series'},
            {data:'',card_id:'12',card_title:'Movie'},
            {data:'',id:99}
        ]},done)
        expect(done.mock.calls[0][0].data).toHaveLength(2)
        expect(done.mock.calls[0][0].data[0].data.id).toBe(12)
        expect(done.mock.calls[0][0].data[1].data.original_name).toBe('Series')
    })
})

function device(){
    const requests=[],node={0:{},addClass(){return this},find(){return this},text:vi.fn()}
    const network={timeout:vi.fn(),clear:vi.fn(),silent:(...args)=>requests.push(args),errorCode:e=>e.code}
    const Modal={open:vi.fn(),close:vi.fn()},Storage={set:vi.fn()},window={location:{reload:vi.fn()}}
    node.on=vi.fn(()=>node)
    const module=loadBrowserModule('src/core/account/device.js', {
        Template:{get:()=>node},Reguest:class{constructor(){return network}},Platform:{tv:()=>false},
        Modal,Storage,window,document:{body:{contains:()=>true}},
        Lang:{translate:x=>x},Api:{url:()=> 'https://cub.example/api/'},
        Noty:{show:vi.fn()},Utils:{onceInit:fn=>fn},Date,setTimeout,clearTimeout
    })
    return {module,requests,network,Modal,Storage,window}
}

describe('device-code login', ()=>{
    it('only polls after opening login and stops on Back, including late replies', ()=>{
        vi.useFakeTimers()
        const s=device()
        expect(s.requests).toHaveLength(0)
        s.module.login()
        s.requests[0][1]({user_code:'TEST',device_code:'fake-device-code',interval:5})
        vi.advanceTimersByTime(5000)
        expect(s.requests[1][0]).toContain('device/token')
        expect(s.network.timeout).toHaveBeenCalledTimes(2)
        expect(s.network.timeout.mock.calls.every(([budget])=>budget===8000)).toBe(true)
        s.Modal.open.mock.calls[0][0].onBack()
        s.requests[1][1]({status:'approved',token:'fake-token',email:'example.invalid',profile:{id:1}})
        vi.advanceTimersByTime(60000)
        expect(s.requests).toHaveLength(2)
        expect(s.Storage.set).not.toHaveBeenCalled()
        expect(s.window.location.reload).not.toHaveBeenCalled()
    })
    it('stores the account only after explicit approval without changing its data format', ()=>{
        vi.useFakeTimers()
        const s=device()
        s.module.login()
        s.requests[0][1]({user_code:'TEST',device_code:'fake-device-code',interval:5})
        vi.advanceTimersByTime(5000)
        s.requests[1][1]({status:'approved',token:'fake-token',email:'test@example.invalid',profile:{id:9}})
        expect(s.Storage.set).toHaveBeenCalledWith('account',{token:'fake-token',email:'test@example.invalid',profile:{id:9}},true)
        expect(s.window.location.reload).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })
})
