import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import Subscribe from '../src/utils/subscribe'
import {loadBrowserModule} from './helpers/browser_module'

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(10000)})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})

function setup(){
    const values={torrserver_url:'http://first.invalid:8090',torrserver_gts:true},requests=[]
    const Storage={get:key=>values[key]||'',field:key=>values[key],listener:Subscribe()}
    function Request(){
        this.clear=vi.fn();this.timeout=vi.fn()
        this.silent=(url,success,fail)=>requests.push({url,success,fail})
    }
    const Torserver=loadBrowserModule('src/interaction/torserver.js',{
        Request,Storage,Utils:{checkEmptyUrl:url=>url.replace(/\/$/,'')},Date,Promise,setTimeout,clearTimeout
    })
    return {Torserver,Storage,Request,values,requests}
}

describe('GStreamer capabilities',()=>{
    it('does not probe an empty URL and does not rewrite the saved preference',async()=>{
        const s=setup();s.values.torrserver_url=''
        expect(await s.Torserver.gstCheck()).toBe(false)
        expect(s.requests).toHaveLength(0)
        expect(s.values.torrserver_gts).toBe(true)
    })
    it('deduplicates pending checks, caches briefly and is independent from torrent network.clear',async()=>{
        const s=setup(),first=s.Torserver.gstCheck()
        expect(s.Torserver.gstCheck()).toBe(first)
        s.Torserver.clear();s.requests[0].success({})
        expect(await first).toBe(true)
        expect(s.Torserver.gstWork()).toBe(true)
        expect(await s.Torserver.gstCheck()).toBe(true)
        expect(s.requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(30001)
        const next=s.Torserver.gstCheck();s.requests[1].success({});await next
        expect(s.requests).toHaveLength(2)
    })
    it.each([401,404,500])('treats an unsupported/failed probe as optional: %s',async status=>{
        const s=setup(),result=s.Torserver.gstCheck()
        s.requests[0].fail({status})
        expect(await result).toBe(false)
        expect(s.Torserver.gstStatus()).toBe('unavailable')
        expect(s.values.torrserver_gts).toBe(true)
    })
    it('bounds even a silent transport and ignores its late successful callback',async()=>{
        const s=setup(),result=s.Torserver.gstCheck()
        await vi.advanceTimersByTimeAsync(5001)
        expect(await result).toBe(false)
        s.requests[0].success({})
        expect(s.Torserver.gstExist()).toBe(false)
    })
    it('does not apply old-server results to a new address',async()=>{
        const s=setup(),first=s.Torserver.gstCheck(),old=s.requests[0]
        s.values.torrserver_url='http://second.invalid:8090'
        expect(s.Torserver.gstExist()).toBe(false)
        const second=s.Torserver.gstCheck()
        expect(await first).toBe(false)
        old.success({});expect(s.Torserver.gstExist()).toBe(false)
        s.requests[1].success({});expect(await second).toBe(true)
        old.fail({status:404});expect(s.Torserver.gstExist()).toBe(true)
    })
    it('keeps the transcode setting visible during and after capability checks',()=>{
        const s=setup(),Settings={listener:Subscribe()},remove=vi.fn()
        loadBrowserModule('src/services/torrserver.js',{
            ...s,Settings,Platform:{is:()=>false},$:()=>({find:()=>({removeClass(){return this},addClass(){return this}})})
        }).init()
        Settings.listener.send('open',{name:'main'})
        Settings.listener.send('open',{name:'server',body:{find:()=>({remove})}})
        expect(remove).not.toHaveBeenCalled()
        s.requests[0].success({})
        expect(remove).not.toHaveBeenCalled()
    })
})
