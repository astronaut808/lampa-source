import {afterEach, describe, expect, it, vi} from 'vitest'
import fs from 'node:fs'

const dependencies = vi.hoisted(()=>({
    cache: {getData: vi.fn(), rewriteData: vi.fn()},
    storage: {field: vi.fn()},
    vpn: {is: vi.fn()},
    template: {elem: vi.fn()},
    color: {circlePattern: vi.fn()}
}))

vi.mock('../src/utils/cache', ()=>({default: dependencies.cache}))
vi.mock('../src/utils/utils', ()=>({default: {protocol: ()=> 'http://'}}))
vi.mock('../src/utils/arrays', ()=>({default: {isObject: value=>value && typeof value == 'object' && !Array.isArray(value)}}))
vi.mock('../src/core/manifest', ()=>({default: {cub_domain: 'example.invalid'}}))
vi.mock('../src/core/vpn', ()=>({default: dependencies.vpn}))
vi.mock('../src/core/storage/storage', ()=>({default: dependencies.storage}))
vi.mock('../src/interaction/template', ()=>({default: dependencies.template}))
vi.mock('../src/utils/color', ()=>({default: dependencies.color}))

async function setup(enabled){
    vi.resetModules()
    dependencies.cache.getData.mockResolvedValue(null)
    dependencies.cache.rewriteData.mockResolvedValue(undefined)
    dependencies.storage.field.mockReturnValue(false)
    dependencies.vpn.is.mockReturnValue(true)
    dependencies.template.elem.mockReturnValue({style: {}})
    dependencies.color.circlePattern.mockReturnValue('pattern')

    const settings = {
        disable_features: {dmca: false, lgbt: false},
        dcma: [{id: 123, cat: 'movie'}],
        lgbt: {'123_movie': true}
    }
    vi.stubGlobal('window', {
        lampa_settings: settings,
        ...(enabled === undefined ? {} : {LampaRuntimeConfig: {contentFilteringEnabled: enabled}})
    })
    const lampa = {
        Network: {silent: vi.fn((url, success)=>success(url.endsWith('/blocked') ? [{id: 123, cat: 'movie'}] : [{id: 123, type: 'movie'}]))},
        SettingsApi: {addParam: vi.fn()},
        Lang: {translate: key=>key}
    }
    vi.stubGlobal('Lampa', lampa)

    return {policy: (await import('../src/custom/content_policy')).default, settings, lampa}
}

afterEach(()=>{
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('content filtering runtime switch', ()=>{
    it.each([undefined, false, 'true', 'false'])('only explicit boolean true enables the browser policy (%s)', async value=>{
        const {policy} = await setup(value)

        expect(policy.enabled()).toBe(false)
    })

    describe.each([false, true])('filtering enabled: %s', enabled=>{
        it('controls cached DMCA matches without deleting settings or confusing movie/TV IDs', async ()=>{
            const {policy, settings} = await setup(enabled)
            const list = settings.dcma

            expect(Boolean(policy.dmcaMatch(list, 'movie', 123))).toBe(enabled)
            expect(Boolean(policy.dmcaMatch(list, 'tv', 123))).toBe(false)
            expect(Boolean(policy.dmcaMatch(false, 'movie', 123))).toBe(false)
            expect(settings.dcma).toBe(list)
            expect(list).toEqual([{id: 123, cat: 'movie'}])
        })

        it('controls supplied blocked/LGBT fields without mutating the card', async ()=>{
            const {policy} = await setup(enabled)
            const card = Object.freeze({id: 123, blocked: true, lgbt: 'keyword (lgbt)'})

            expect(policy.blocksCard(card)).toBe(enabled)
            expect(policy.blocksCard({lgbt: 'list'})).toBe(enabled)
            expect(policy.blocksCard({blocked: true})).toBe(enabled)
            expect(policy.blocksCard({id: 456})).toBe(false)
            expect(policy.blocksCard(null)).toBe(false)
            expect(card.blocked).toBe(true)
        })

        it('controls exact search stop-words without blocking longer titles', async ()=>{
            const {policy} = await setup(enabled)
            const stopKeys = ['лгбт', 'sex']

            expect(policy.searchAllowed(' ЛГБТ ', stopKeys)).toBe(!enabled)
            expect(policy.searchAllowed('sex', stopKeys)).toBe(!enabled)
            expect(policy.searchAllowed('Sex Education', stopKeys)).toBe(true)
            expect(policy.searchAllowed('обычный фильм', stopKeys)).toBe(true)
        })

        it('controls visible keyword tags while retaining their original objects', async ()=>{
            const {policy} = await setup(enabled)
            const tags = [{name: 'Drama'}, {name: 'LGBT'}, {name: 'Sex'}]
            const visible = policy.visibleKeywords(tags, ['sex'], ['lgbt'])

            expect(visible).toEqual(enabled ? [tags[0]] : tags)
            expect(visible[0]).toBe(tags[0])
            expect(tags).toHaveLength(3)
        })

        it('retains sensitive search, tags and adult checks for child profiles', async ()=>{
            const {policy} = await setup(enabled)

            expect(policy.sensitiveContentRestricted(true)).toBe(true)
            expect(policy.searchAllowed('лгбт', ['лгбт'], true)).toBe(false)
            expect(policy.visibleKeywords([{name: 'lgbt'}, {name: 'drama'}], [], ['lgbt'], true)).toEqual([{name: 'drama'}])
            expect(policy.sensitiveContentRestricted(false)).toBe(enabled)
        })

        it('controls loading both blocklists without altering CUB settings', async ()=>{
            const {settings, lampa} = await setup(enabled)
            const dmca = (await import('../src/services/dmca')).default
            const lgbt = (await import('../src/services/lgbt')).default

            dmca.init()
            lgbt.init()
            await new Promise(resolve=>setTimeout(resolve, 0))

            expect(lampa.Network.silent).toHaveBeenCalledTimes(enabled ? 2 : 0)
            expect(dependencies.cache.getData).toHaveBeenCalledTimes(enabled ? 1 : 0)
            expect(settings.disable_features).toEqual({dmca: false, lgbt: false})
            if(enabled){
                expect(lampa.Network.silent.mock.calls.map(call=>call[0])).toEqual([
                    'http://tmdb.example.invalid/blocked',
                    'http://tmdb.example.invalid/lgbt.json'
                ])
            }
        })

        it('controls reading the cached LGBT list and respects existing feature opt-outs', async ()=>{
            const {settings, lampa} = await setup(enabled)
            const cached = {'456_tv': true}
            dependencies.cache.getData.mockResolvedValue(cached)
            const lgbt = (await import('../src/services/lgbt')).default

            lgbt.init()
            await new Promise(resolve=>setTimeout(resolve, 0))

            expect(lampa.Network.silent).not.toHaveBeenCalled()
            expect(settings.lgbt).toEqual(enabled ? cached : {'123_movie': true})
            settings.disable_features.lgbt = true
            dependencies.cache.getData.mockClear()
            await lgbt.init()
            expect(dependencies.cache.getData).not.toHaveBeenCalled()
        })

        it('does not add the LGBT poster overlay in unrestricted mode even in RU/BY', async ()=>{
            await setup(enabled)
            const module = (await import('../src/interaction/card/module/lgbt')).default
            const img = {after: vi.fn()}

            module.onVisible.call({data: {id: 123}, html: {find: ()=>img}})

            expect(img.after).toHaveBeenCalledTimes(enabled ? 1 : 0)
            expect(dependencies.color.circlePattern).toHaveBeenCalledTimes(enabled ? 1 : 0)
        })
    })

    it('keeps the new switch connected to all client filtering entry points', ()=>{
        const read = file=>fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
        const full = read('src/components/full.js')
        const results = read('src/interaction/search/results.js')

        expect(read('src/utils/utils.js')).toContain('ContentPolicy.dmcaMatch(window.lampa_settings.dcma, media, id)')
        expect(full).toContain('if(ContentPolicy.blocksCard(data.movie)) return fail(')
        expect(full).toContain('if(!data.movie) return fail({empty: true})')
        expect(full).toContain('Utils.canWatchChildren(TMDB.parsePG(data.movie), Permit.profile.age)')
        expect(results.match(/ContentPolicy.enabled\(\) && Arrays.isArray\(window.lampa_settings.dcma\)/g)).toHaveLength(2)
        expect(read('src/interaction/search/sources.js')).toContain('ContentPolicy.searchAllowed(query, stop_keys, Permit.child)')
        expect(read('src/components/full/descr.js')).toContain('ContentPolicy.visibleKeywords(key_tags, Keys.adult, Keys.lgbt, Permit.child)')
    })

    it('declares the same reversible container setting in both compose files and the env example', ()=>{
        for(const file of ['docker-compose.yaml', 'deploy/compose.yaml']){
            const content = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
            expect(content).toContain('LAMPA_CONTENT_FILTERING_ENABLED: "${LAMPA_CONTENT_FILTERING_ENABLED:-false}"')
        }
        expect(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8')).toContain('LAMPA_CONTENT_FILTERING_ENABLED=false')
    })
})
