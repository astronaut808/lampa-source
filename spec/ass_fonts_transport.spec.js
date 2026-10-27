import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'

afterEach(()=>vi.useRealTimers())

function transport({auth=true, hang=false}={}){
    const fetch=vi.fn(async()=>({ok:true,status:206,headers:{get:()=>null},
        json:()=>Promise.resolve({file_stats:[{id:1,path:'font.ttf',length:2048}]}),
        arrayBuffer:()=>hang?new Promise(()=>{}):Promise.resolve(new Uint8Array([1,2,3]).buffer)}))
    const createObjectURL=vi.fn(()=> 'blob:font-fixture'),revokeObjectURL=vi.fn()
    class FontURL extends URL {}
    FontURL.createObjectURL=createObjectURL
    FontURL.revokeObjectURL=revokeObjectURL
    const module=loadBrowserModule('src/interaction/player/subtitles/ass/torfonts.js',{
        Torserver:{url:()=> 'http://server:8090/ts'},
        Storage:{field:()=>auth,get:()=> 'fixture-user',value:()=> 'fixture-password'},
        Base64:{encode:value=>Buffer.from(value).toString('base64')},fetch,URL:FontURL,Blob,
        AbortController,setTimeout,clearTimeout,Promise,Uint8Array
    })
    return {module,fetch,createObjectURL,revokeObjectURL}
}

describe('TorrServer ASS font transport',()=>{
    it('authenticates discovery, ranges and materialization without URL credentials',async()=>{
        const s=transport()
        const files=await s.module.listFiles('hash')
        const link=s.module.url('hash',files[0])
        await s.module.range(link,0,3)
        const asset=await s.module.asset('hash',files[0])
        expect(s.fetch).toHaveBeenCalledTimes(3)
        for(const [url,options] of s.fetch.mock.calls){
            expect(url).not.toContain('fixture-')
            expect(options.headers.Authorization).toBe('Basic '+Buffer.from('fixture-user:fixture-password').toString('base64'))
            expect(options.redirect).toBe('error')
        }
        expect(s.fetch.mock.calls[1][1].headers.Range).toBe('bytes=0-2')
        expect(asset.url).toBe('blob:font-fixture')
        asset.release()
        expect(s.revokeObjectURL).toHaveBeenCalledWith('blob:font-fixture')
    })
    it('preserves lazy raw font URLs when authentication is disabled',async()=>{
        const s=transport({auth:false})
        const asset=await s.module.asset('hash',{id:1,path:'font.ttf',length:2048})
        expect(asset.url).toContain('/ts/stream/font.ttf?')
        expect(s.fetch).not.toHaveBeenCalled()
        await s.module.listFiles('hash')
        expect(s.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
    })
    it.each(['http://evil.example/ts/font.ttf','http://server:8090/ts-evil/font.ttf'])('does not send credentials outside the configured server path: %s',async link=>{
        const s=transport()
        await expect(s.module.full(link)).rejects.toThrow('outside TorrServer')
        expect(s.fetch).not.toHaveBeenCalled()
    })
    it('bounds response body reads and aborts after the deadline',async()=>{
        vi.useFakeTimers()
        const s=transport({hang:true})
        const result=expect(s.module.full('http://server:8090/ts/font.ttf')).rejects.toThrow('timeout')
        await vi.advanceTimersByTimeAsync(8001)
        await result
        expect(s.fetch.mock.calls[0][1].signal.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })
})

function fonts({pending=false}={}){
    let resolveAsset
    const release=vi.fn()
    const asset=vi.fn(()=>pending?new Promise(resolve=>{resolveAsset=resolve}):Promise.resolve({url:'blob:font',release}))
    const module=loadBrowserModule('src/interaction/player/subtitles/ass/fonts.js',{
        Parser:{parse:()=>({events:[],styles:{Default:{font:'Fixture'}}})},
        Sfnt:{readNames:async()=>[{names:['Fixture'],family:'Fixture',subfamily:'Regular',weight:400}]},
        Promise,setTimeout,console:{log:vi.fn()}
    })
    const transport={listFiles:async()=>[{id:1,path:'font.ttf',length:2048}],url:()=> 'http://server/font.ttf',range:vi.fn(),asset}
    const session=module.createSession({hash:'fixture',text:'ASS',transport})
    return {session,release,asset,complete:()=>resolveAsset({url:'blob:font',release})}
}

describe('font session resource ownership',()=>{
    it('does not start another SFNT range after cancellation during the first read',async()=>{
        let complete
        const range=vi.fn(()=>new Promise(resolve=>{complete=resolve}))
        const module=loadBrowserModule('src/interaction/player/subtitles/ass/fonts.js',{
            Parser:{parse:()=>({events:[],styles:{Default:{font:'Fixture'}}})},
            Sfnt:{readNames:async read=>{await read(0,3);await read(3,6);return []}},
            Promise,setTimeout,console:{log:vi.fn()}
        })
        const session=module.createSession({hash:'cancel-pending',text:'ASS',transport:{
            listFiles:async()=>[{id:1,path:'font.ttf',length:2048}],url:()=> 'http://server/font.ttf',range
        }})
        await new Promise(resolve=>setTimeout(resolve,0))
        expect(range).toHaveBeenCalledOnce()
        session.cancel()
        complete(new Uint8Array(3))
        await new Promise(resolve=>setTimeout(resolve,0))
        expect(range).toHaveBeenCalledOnce()
    })
    it('does not issue retry or full-file requests after cancellation',async()=>{
        vi.useFakeTimers()
        const range=vi.fn(),full=vi.fn()
        const module=loadBrowserModule('src/interaction/player/subtitles/ass/fonts.js',{
            Parser:{parse:()=>({events:[],styles:{Default:{font:'Fixture'}}})},
            Sfnt:{readNames:async read=>{await read(0,3);return []}},
            Promise,setTimeout,console:{log:vi.fn()}
        })
        const session=module.createSession({hash:'cancel',text:'ASS',transport:{
            listFiles:async()=>[{id:1,path:'font.ttf',length:2048}],url:()=> 'http://server/font.ttf',range,full
        }})
        await vi.advanceTimersByTimeAsync(1)
        expect(range).toHaveBeenCalledOnce()
        session.cancel()
        await vi.advanceTimersByTimeAsync(3000)
        expect(range).toHaveBeenCalledOnce()
        expect(full).not.toHaveBeenCalled()
    })
    it.each([[],[{id:1,path:'video.mkv',length:2048}]])('resolves completion when there are no font files: %j',async files=>{
        const module=loadBrowserModule('src/interaction/player/subtitles/ass/fonts.js',{
            Parser:{parse:()=>({events:[],styles:{Default:{font:'Fixture'}}})},
            Promise,setTimeout,console:{log:vi.fn()}
        })
        const session=module.createSession({hash:'empty',text:'ASS',transport:{listFiles:async()=>files}})
        await session.done
        expect(session.fonts).toEqual([])
    })
    it('releases authenticated font URLs exactly once on cancellation',async()=>{
        const s=fonts()
        await s.session.done
        expect(s.session.fonts[0].url).toBe('blob:font')
        s.session.cancel()
        s.session.cancel()
        expect(s.release).toHaveBeenCalledOnce()
    })
    it('releases a font that arrives after cancellation and does not emit it',async()=>{
        const s=fonts({pending:true})
        await new Promise(resolve=>setTimeout(resolve,0))
        expect(s.asset).toHaveBeenCalledOnce()
        s.session.cancel()
        s.complete()
        await new Promise(resolve=>setTimeout(resolve,0))
        expect(s.session.fonts).toHaveLength(0)
        expect(s.release).toHaveBeenCalledOnce()
    })
})
