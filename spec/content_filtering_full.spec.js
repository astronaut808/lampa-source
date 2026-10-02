import {afterEach, describe, expect, it, vi} from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

const fullSource = fs.readFileSync(new URL('../src/components/full.js', import.meta.url), 'utf8')
    .replace(/^import .+$/gm, '').replace('export default component', 'globalThis.createCard = component')
const utilsSource = fs.readFileSync(new URL('../src/utils/utils.js', import.meta.url), 'utf8')
const ageCheck = utilsSource.slice(utilsSource.indexOf('function canWatchChildren('), utilsSource.indexOf('\nfunction trigger('))

async function cardHarness(enabled, child = false, lgbtList = {}){
    vi.resetModules()
    const window = {
        LampaRuntimeConfig: {contentFilteringEnabled: enabled},
        lampa_settings: {dcma: [], lgbt: lgbtList},
        innerWidth: 700
    }
    vi.stubGlobal('window', window)
    const policy = (await import('../src/custom/content_policy')).default
    const permit = {child, profile: {age: 12}}
    const api = {full: vi.fn()}
    const listener = {send: vi.fn()}
    const html = {addClass: vi.fn(), prepend: vi.fn(), find: ()=>({remove: vi.fn()})}
    const activity = {loader: vi.fn(), toggle: vi.fn()}
    const comp = {
        object: {id: 123, method: 'movie'}, params: {empty: {}}, html, activity, items: [], scroll: {},
        props: {
            data: {},
            set(data){Object.assign(this.data, data)},
            get(key){return this.data[key]}
        },
        use(handlers){this.handlers = handlers},
        emit: vi.fn(function(name, ...args){
            const handler = this.handlers['on' + name[0].toUpperCase() + name.slice(1)]
            if(handler) handler.call(this, ...args)
        }),
        empty: vi.fn()
    }
    const context = {
        window, ContentPolicy: policy, Permit: permit, Api: api,
        Lampa: {Listener: listener, Account: {Permit: permit}},
        $: value=>value,
        Utils: {createInstance: ()=>comp, dcma: ()=>policy.dmcaMatch(window.lampa_settings.dcma, 'movie', 123)},
        MainModule: {only: vi.fn()}, Platform: {screen: ()=>true},
        VPN: {is: ()=>true}, Storage: {field: ()=>false},
        TMDB: {parsePG: movie=>movie.rating || '18+'},
        Keys: {lgbt: ['lgbt'], adult: ['sex']},
        Lang: {translate: key=>key}, Template: {elem: ()=>({})}, Timetable: {update: vi.fn()}
    }
    for(const name of ['Start', 'Description', 'MetadataChart', 'MetadataTags', 'Persons', 'Discuss', 'Episodes', 'Cards', 'Main']) context[name] = class {}
    vm.runInNewContext(ageCheck + '\nglobalThis.ageCheck = canWatchChildren', context)
    context.Utils.canWatchChildren = vi.fn(context.ageCheck)
    vm.runInNewContext(fullSource, context)
    context.createCard(comp.object)
    comp.emit('create')
    expect(api.full).toHaveBeenCalledTimes(1)
    return {comp, context, success: api.full.mock.calls[0][1], failure: api.full.mock.calls[0][2]}
}

afterEach(()=>vi.unstubAllGlobals())

describe.each([false, true])('full-card callback, content filtering=%s', enabled=>{
    it.each([
        ['server DMCA flag', {blocked: true}, {}, undefined],
        ['server LGBT flag', {lgbt: 'server'}, {}, 'server'],
        ['cached LGBT list', {}, {'123_movie': true}, 'list'],
        ['LGBT keyword', {keywords: {keywords: [{name: 'LGBT'}]}}, {}, 'keyword (lgbt)']
    ])('handles %s in the actual card load callback', async (_, flags, list, reason)=>{
        const {comp, success} = await cardHarness(enabled, false, list)
        success({movie: {id: 123, title: 'Movie', ...flags}})

        if(enabled){
            expect(comp.empty).toHaveBeenCalledWith(expect.objectContaining({blocked: true}))
            expect(comp.empty.mock.calls[0][0].lgbt).toBe(reason)
            expect(comp.card_ready).toBe(false)
            expect(comp.activity.toggle).not.toHaveBeenCalled()
        }
        else{
            expect(comp.empty).not.toHaveBeenCalled()
            expect(comp.card_ready).toBe(true)
            expect(comp.activity.loader).toHaveBeenCalledWith(false)
            expect(comp.activity.toggle).toHaveBeenCalledTimes(1)
            expect(comp.object.card.id).toBe(123)
        }
    })

    it('retains the missing-card and upstream HTTP error paths', async ()=>{
        const {comp, success, failure} = await cardHarness(enabled)
        success({})
        expect(comp.empty).toHaveBeenCalledWith({empty: true})
        failure({status: 404})
        expect(comp.empty).toHaveBeenLastCalledWith({status: 404})
        expect(comp.activity.toggle).not.toHaveBeenCalled()
        expect(comp.card_ready).toBe(false)
    })

    it('only suppresses related rows for adult keywords when filtering is enabled', async ()=>{
        const {comp, context, success} = await cardHarness(enabled)
        success({
            movie: {id: 456, title: 'Movie', keywords: {keywords: [{name: 'sex'}]}},
            recomend: {results: [{id: 789}]}
        })
        expect(comp.rows.some(row=>Array.isArray(row) && row[0] === 'cards')).toBe(!enabled)
        expect(Boolean(comp.object.card.adult)).toBe(enabled)
        expect(context.Lampa.Listener.send).toHaveBeenCalledWith('full', expect.objectContaining({type: 'complite'}))
        expect(comp.card_ready).toBe(true)
    })

    it('still applies the real child age check and sensitive keyword restrictions', async ()=>{
        const {comp, context, success} = await cardHarness(enabled, true)
        success({
            movie: {id: 456, title: 'Movie', rating: '18+', keywords: {keywords: [{name: 'sex'}]}},
            recomend: {results: [{id: 789}]}
        })
        expect(context.Utils.canWatchChildren).toHaveBeenCalledWith('18+', 12)
        expect(context.Utils.canWatchChildren.mock.results[0].value).toBe(false)
        expect(context.Lampa.Listener.send.mock.calls.filter(([name])=>name === 'full')).toHaveLength(0)
        expect(comp.object.card.adult).toBe(true)
        expect(comp.rows.some(row=>Array.isArray(row) && row[0] === 'cards')).toBe(false)
    })
})
