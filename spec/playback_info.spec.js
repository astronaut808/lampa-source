import fs from 'node:fs'
import vm from 'node:vm'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import Subscribe from '../src/utils/subscribe'

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(10000)})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})

function setup({transcode=false,externalSubs=false}={}){
    const requests=[],elements=[]
    function $(selector){
        if(typeof selector!=='string') return selector
        let position=0
        const node={0:{},selector,children:[],value:'',classes:new Set(),
            on(){return this},addClass(name){this.classes.add(name);return this},removeClass(name){this.classes.delete(name);return this},
            append(...nodes){this.children.push(...nodes);return this},empty(){this.children=[];return this},
            text(value){if(value===undefined)return this.value;this.value=value;return this},html(value){this.value=value;return this},
            height:()=>100,scrollTop(value){if(value===undefined)return position;position=value;return this},
            find:()=> $('<child>'),parent:()=>({children:()=>({each:()=>{}})})}
        elements.push(node);return node
    }
    function Reguest(){
        this.clear=vi.fn();this.timeout=value=>{this.budget=value}
        this.silent=(url,success,fail)=>requests.push({url,success,fail,budget:this.budget,network:this})
    }
    const data={torrent_hash:'fixture',url:transcode?'http://server.invalid/gst/fixture/master.m3u8?index=0':'http://server.invalid/stream/file?index=0&play'}
    const Player={listener:Subscribe(),playdata:()=>data},Panel={listener:Subscribe()}
    const SubsTorserver={fileIndex:()=>0,available:()=>externalSubs,
        load:vi.fn(()=>({destroy:vi.fn()}))}
    const context={$,Reguest,Player,Panel,SubsTorserver,
        Torserver:{url:()=> 'http://server.invalid',toPlayUrl:url=>url,gstWork:()=>transcode},
        Video:{render:()=>({0:{}})},Controller:{add:vi.fn(),enabled:()=>({name:'player'}),toggle:vi.fn()},
        Lang:{translate:key=>key},Utils:{secondsToTime:String,bytesToSize:String},
        languageName:String,codecName:String,channelLayout:String,
        Date,Math,setTimeout,clearTimeout,setInterval,clearInterval}
    const code=fs.readFileSync(new URL('../src/interaction/player/playback_info.js',import.meta.url),'utf8')
        .replace(/^import .* from .*$/gm,'').replace(/^export \{parseGst\}$/m,'')
        .replace('export default','globalThis.moduleResult =')
    vm.runInNewContext(code,context)
    const module=context.moduleResult;module.init()
    const body=elements.find(node=>node.selector.includes('class="playback-info__body"'))
    function text(node=body){return node.value+' '+node.children.map(child=>child&&typeof child==='object'?text(child):String(child)).join(' ')}
    return {module,Player,Panel,requests,body,text,SubsTorserver}
}

describe('Progressive playback information',()=>{
    it('makes no requests at initialization, then shows known information immediately',()=>{
        const s=setup()
        expect(s.requests).toHaveLength(0)
        s.module.open()
        expect(s.text()).toContain('playback_info_direct')
        expect(s.text()).toContain('playback_info_speed')
        expect(s.text()).toContain('loading')
        s.requests[0].success({file_stats:[{id:0,path:'movie.mkv',length:1024}]})
        expect(s.text()).toContain('movie.mkv')
        expect(s.text()).toContain('loading')
    })
    it('shares an eight-second budget across ffprobe and GStreamer fallback',async()=>{
        const s=setup();s.module.open()
        await vi.advanceTimersByTimeAsync(4001)
        const probes=s.requests.filter(req=>req.url.includes('/probe'))
        expect(probes).toHaveLength(1)
        expect(probes[0].budget).toBeLessThanOrEqual(4000)
        await vi.advanceTimersByTimeAsync(4000)
        expect(s.text()).toContain('playback_info_noprobe')
        s.module.close();expect(vi.getTimerCount()).toBe(0)
    })
    it('ignores closed-session responses and does not launch fallback after Back',()=>{
        const s=setup();s.module.open()
        const old=s.requests.find(req=>req.url.includes('/ffp/'))
        s.module.close();const count=s.requests.length
        old.fail({status:404});old.success({streams:[]})
        expect(s.requests).toHaveLength(count)
        expect(s.body.children).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
    })
    it('keeps scroll position when another section arrives',()=>{
        const s=setup();s.module.open();s.body.scrollTop(123)
        s.requests[0].success({file_stats:[{id:0,path:'movie.mkv'}]})
        expect(s.body.scrollTop()).toBe(123)
    })
    it('polls serially and stops polling on player destruction, including late callbacks',async()=>{
        const s=setup({transcode:true});s.module.open()
        const stats=()=>s.requests.filter(req=>req.url.endsWith('/heartbeat'))
        expect(stats()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(stats()).toHaveLength(1)
        stats()[0].success({download_speed:100})
        await vi.advanceTimersByTimeAsync(1000)
        expect(stats()).toHaveLength(2)
        s.Player.listener.send('destroy')
        stats()[1].success({download_speed:200})
        await vi.advanceTimersByTimeAsync(10000)
        expect(stats()).toHaveLength(2)
        expect(vi.getTimerCount()).toBe(0)
    })
    it('bounds a stalled external subtitles loader and cancels it when closed',async()=>{
        const s=setup({externalSubs:true});s.module.open()
        const handle=s.SubsTorserver.load.mock.results[0].value
        await vi.advanceTimersByTimeAsync(5001)
        expect(handle.destroy).toHaveBeenCalled()
        s.module.close();expect(vi.getTimerCount()).toBe(0)
    })
    it.each([401,404,500])('continues to show available data when probes fail: %s',status=>{
        const s=setup({transcode:true});s.module.open()
        s.requests.find(req=>req.url.includes('/probe')).fail({status})
        expect(s.text()).toContain('playback_info_transcode')
        expect(s.text()).toContain('playback_info_noprobe')
        s.module.close()
    })
    it('does not restart requests when the already-open overlay receives another open',()=>{
        const s=setup();s.module.open();const count=s.requests.length
        s.module.open();expect(s.requests).toHaveLength(count)
    })
})
