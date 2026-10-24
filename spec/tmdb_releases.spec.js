import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'

function setup(enabled = false){
    const requests = []
    const instances = []
    class Reguest {
        constructor(){this.clear = vi.fn(); this.timeout = vi.fn(); instances.push(this)}
        silent(url, success, error, post, options){requests.push({url, success, error, post, options, owner: this})}
    }
    const settings = {tmdb_only_released: enabled, tmdb_lang: 'ru'}
    const Status = loadBrowserModule('src/utils/status.js', {})
    const api = loadBrowserModule('src/core/api/sources/tmdb.js', {
        Reguest, Status, Date, setTimeout, clearTimeout,
        Arrays: {isArray: Array.isArray, insert: (list, index, value)=>list.splice(index, 0, value), shuffleArrayFromIndex: ()=>{}}, Keys: {filter: []},
        Storage: {field: name=>settings[name]},
        TMDB: {api: path=>'https://tmdb.example/3/' + path, key: ()=> 'test-key'},
        Permit: {}, CustomConfig: {fastStartupEnabled: true, progressiveCardEnabled: true},
        Utils: {addSource: data=>data}, Lang: {translate: key=>key},
        ContentRows: {call: ()=>{}},
        Api: {partKeywords: ()=>()=>{}, partPersons: ()=>()=>{}, partNext: (parts, limit)=>parts.slice(0, limit).forEach(part=>part(()=>{}))}
    })
    const movie = (id = 1)=>({id, title: 'Movie', release_date: '2026-10-01'})
    function dates(request, date = '2026-10-10'){
        request.success({results: [{release_dates: date ? [{type: 4, release_date: date + 'T00:00:00Z'}] : []}]})
    }
    return {api, requests, instances, settings, movie, dates}
}

afterEach(()=>vi.useRealTimers())

describe('TMDB release-only filter', ()=>{
    it.each([false, true])('uses the selected now-playing query in main, categories and menu (enabled: %s)', enabled=>{
        const s = setup(enabled)
        const done = vi.fn()
        s.api.main({}, ()=>{}, ()=>{})
        expect(s.requests[0].url).toContain(enabled ? 'discover/movie?with_release_type=4|5|6' : 'movie/now_playing?')
        s.requests.length = 0
        s.api.category({url: 'movie'}, ()=>{}, ()=>{})
        expect(s.requests[0].url).toContain(enabled ? 'with_release_type=4|5|6' : 'with_release_type=1')
        s.api.menuCategory({action: 'movie'}, done)
        expect(done.mock.calls[0][0][0].url).toContain(enabled ? 'with_release_type=4|5|6' : 'movie/now_playing')
    })

    it.each(['search/movie', 'person/123/movie_credits', 'movie/upcoming', 'movie/123/videos'])('does not apply release checks to %s', method=>{
        const s = setup(true)
        const done = vi.fn()
        const results = [{id: 1, release_date: '2099-01-01'}]
        s.api.get(method, {}, done)
        s.requests[0].success({results})
        expect(done.mock.calls[0][0].results).toEqual(results)
        expect(s.requests).toHaveLength(1)
    })

    it.each([4, 5, 6])('accepts TMDB home-release type %s', type=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const done = vi.fn()
        s.api.get('movie/popular', {}, done)
        s.requests[0].success({results: [s.movie()]})
        s.requests[1].success({results: [{release_dates: [{type, release_date: '2026-10-10T00:00:00Z'}]}]})
        expect(done.mock.calls[0][0].results).toHaveLength(1)
    })

    it('keeps a disabled filter request-free and preserves future and undated titles', ()=>{
        const s = setup()
        const done = vi.fn()
        const results = [s.movie(), {id: 2, release_date: '2099-01-01'}, {id: 3}]
        s.api.get('movie/popular', {}, done)
        s.requests[0].success({results})
        expect(done).toHaveBeenCalledOnce()
        expect(done.mock.calls[0][0].results).toEqual(results)
        expect(s.requests).toHaveLength(1)
    })

    it('does not skip empty pages or mutate pagination when the filter is disabled', ()=>{
        const s = setup()
        const done = vi.fn()
        const params = {url: 'discover/movie', page: 1}
        s.api.list(params, done)
        s.requests[0].success({results: [], total_pages: 10})
        expect(done).toHaveBeenCalledOnce()
        expect(s.requests).toHaveLength(1)
        expect(params.page).toBe(1)
    })

    it('filters only when explicitly selected and does not mutate cached response lists', ()=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const done = vi.fn()
        const cached = {results: [s.movie(1), s.movie(2), {id: 3, first_air_date: '2099-01-01'}]}
        s.api.list({url: 'trending/all/day', page: 1}, done)
        s.requests[0].success(cached)
        expect(done).not.toHaveBeenCalled()
        s.dates(s.requests[1])
        s.dates(s.requests[2], '')
        expect(done.mock.calls[0][0].results.map(item=>item.id)).toEqual([1])
        expect(cached.results.map(item=>item.id)).toEqual([1, 2, 3])
    })

    it.each(['error', 'malformed'])('keeps a movie visible on a %s release-date response', result=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const done = vi.fn()
        s.api.get('movie/popular', {}, done)
        s.requests[0].success({results: [s.movie()]})
        if(result === 'error') s.requests[1].error({status: 503})
        else s.requests[1].success({error: 'unexpected'})
        expect(done).toHaveBeenCalledOnce()
        expect(done.mock.calls[0][0].results).toHaveLength(1)
    })

    it('does not apply a movie release decision to a TV series sharing its numeric id', ()=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const done = vi.fn()
        const series = {id: 1, media_type: 'tv', first_air_date: '2020-01-01'}
        s.api.list({url: 'trending/all/day', page: 1}, done)
        s.requests[0].success({results: [s.movie(), series]})
        s.dates(s.requests[1], '')
        expect(done).toHaveBeenCalledOnce()
        expect(done.mock.calls[0][0].results).toEqual([series])
    })

    it('deduplicates concurrent checks and reuses their date cache', ()=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const first = vi.fn(), second = vi.fn(), third = vi.fn()
        s.api.get('movie/popular', {}, first)
        s.requests[0].success({results: [s.movie()]})
        s.api.get('movie/top_rated', {}, second)
        s.requests[2].success({results: [s.movie()]})
        expect(s.requests.filter(item=>item.url.includes('/release_dates?'))).toHaveLength(1)
        s.dates(s.requests[1])
        expect(first).toHaveBeenCalledOnce()
        expect(second).toHaveBeenCalledOnce()
        s.api.get('movie/popular', {}, third)
        s.requests[3].success({results: [s.movie()]})
        expect(third).toHaveBeenCalledOnce()
        expect(s.requests).toHaveLength(4)
    })

    it('does not let a late release response update an activity after clear()', ()=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const done = vi.fn()
        s.api.get('movie/popular', {}, done)
        s.requests[0].success({results: [s.movie()]})
        s.api.clear()
        s.dates(s.requests[1])
        expect(done).not.toHaveBeenCalled()
        expect(s.instances[1].clear).toHaveBeenCalled()
    })

    it('does not leave deduplication stuck after navigation cancels a request', ()=>{
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
        const s = setup(true)
        const old = vi.fn(), next = vi.fn()
        s.api.get('movie/popular', {}, old)
        s.requests[0].success({results: [s.movie()]})
        s.api.clear()
        s.api.get('movie/popular', {}, next)
        s.requests[2].success({results: [s.movie()]})
        expect(s.requests).toHaveLength(4)
        s.dates(s.requests[1], '')
        expect(next).not.toHaveBeenCalled()
        s.dates(s.requests[3])
        expect(next).toHaveBeenCalledOnce()
        expect(old).not.toHaveBeenCalled()
    })

    it('bounds filter-driven pagination and reflects the last fetched page', ()=>{
        const s = setup(true)
        const done = vi.fn()
        const params = {url: 'discover/movie', page: 1}
        s.api.list(params, done)
        for(let index = 0; index < 6; index++) s.requests[index].success({results: [{id: index, first_air_date: '2099-01-01'}], total_pages: 100})
        expect(s.requests).toHaveLength(6)
        expect(done).toHaveBeenCalledOnce()
        expect(params.page).toBe(6)
    })
})
