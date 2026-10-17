import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import Subscribe from '../src/utils/subscribe'
import {loadBrowserModule} from './helpers/browser_module'

beforeEach(()=>{vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())

function setup(files = {}){
    const Account = {Permit: {sync: true, account: {profile: {id: 1}}}, hasPremium: ()=>true}
    const values = {'file_view_1': {}, ...files}
    const Storage = {get: (key, fallback)=>values[key] || fallback, set: vi.fn((key, value)=>{values[key] = value})}
    const Socket = {send: vi.fn()}
    const node = {toggleClass(){return this}, css(){return this}, each(){return this}}
    const Timeline = loadBrowserModule('src/interaction/timeline.js', {
        Storage, Socket, Account, Subscribe,
        Activity: {renderLayers: ()=>[]},
        Utils: {onceInit: fn=>fn, hash: value=>String(value), secondsToTimeHuman: String},
        document: {}, $: ()=>node, Lampa: {Listener: Subscribe()}
    })
    Timeline.init()
    return {Timeline, Storage, Socket, Account, values}
}

const movie = {id: 42, original_title: 'Original title'}
const show = {id: 42, original_name: 'Original series'}
const progress = (card, percent, updated = 10)=>({card, percent, time: 20, duration: 100, profile: 1, updated})

describe('timeline identity and extension compatibility', ()=>{
    it('retains numeric legacy progress and the single-argument extension API', ()=>{
        const s = setup({'file_view_1': {legacy: 95}})
        const view = s.Timeline.view('legacy')
        expect(view.percent).toBe(95)
        view.handler(50, 12.5, 25)
        expect(s.values.file_view_1.legacy).toMatchObject({percent: 50, time: 13, duration: 25, profile: 1})
        expect(s.values.file_view_1.legacy).not.toHaveProperty('card')
    })

    it('retains legacy object progress and gives the exact hash priority over metadata', ()=>{
        const s = setup({'file_view_1': {exact: {...progress('movie_42', 10), card: undefined}, other: progress('movie_42', 90, 100)}})
        expect(s.Timeline.view('exact', s.Timeline.link(movie)).percent).toBe(10)
    })

    it('does not replace an explicit zero-percent hash with an older linked position', ()=>{
        const s = setup({'file_view_1': {exact: 0, other: progress('movie_42', 90)}})
        expect(s.Timeline.view('exact', s.Timeline.link(movie)).percent).toBe(0)
    })

    it('finds progress after a title/hash change and writes using the new hash', ()=>{
        const s = setup({'file_view_1': {oldTitleHash: progress('movie_42', 60)}})
        const view = s.Timeline.view('renamedTitleHash', s.Timeline.link(movie))
        expect(view).toMatchObject({hash: 'renamedTitleHash', card: 'movie_42', percent: 60, time: 20})
        view.handler(70, 70, 100)
        expect(s.values.file_view_1.renamedTitleHash).toMatchObject({card: 'movie_42', percent: 70})
        expect(s.values.file_view_1.oldTitleHash.percent).toBe(60)
    })

    it('uses the most recently updated identity match', ()=>{
        const s = setup({'file_view_1': {newer: progress('movie_42', 70, 50), older: progress('movie_42', 20, 10)}})
        expect(s.Timeline.view('renamed', s.Timeline.link(movie)).percent).toBe(70)
    })

    it('isolates movies, series, seasons and episodes', ()=>{
        const s = setup({'file_view_1': {
            film: progress('movie_42', 90),
            first: {...progress('tv_42', 20), season: 1, episode: 2},
            second: {...progress('tv_42', 40), season: 2, episode: 2}
        }})
        expect(s.Timeline.view('filmNew', s.Timeline.link(movie)).percent).toBe(90)
        expect(s.Timeline.view('seriesNew', s.Timeline.link(show, 1, 2)).percent).toBe(20)
        expect(s.Timeline.view('seasonNew', s.Timeline.link(show, 2, 2)).percent).toBe(40)
        expect(s.Timeline.view('episodeNew', s.Timeline.link(show, 1, 3)).percent).toBe(0)
    })

    it('keeps TMDB/CUB identity shared but separates other catalog sources', ()=>{
        const {Timeline} = setup()
        expect(Timeline.link({...movie, source: 'cub'})).toEqual(Timeline.link({...movie, source: 'tmdb'}))
        expect(Timeline.link({...movie, source: 'other'})).toEqual({card: 'other_movie_42'})
    })

    it('keeps special season zero and numeric string episode metadata', ()=>{
        const {Timeline} = setup()
        expect(Timeline.link(show, '0', '2')).toEqual({card: 'tv_42', season: 0, episode: 2})
        expect(Timeline.link(show)).toBe(null)
        expect(Timeline.link(null)).toBe(null)
        expect(Timeline.link({})).toBe(null)
    })

    it('resets the identity index on profile changes and logout', ()=>{
        const s = setup({'file_view_1': {a: progress('movie_42', 80)}, 'file_view_2': {}, file_view: {local: 30}})
        s.Account.Permit.account.profile.id = 2
        s.Timeline.read()
        expect(s.Timeline.view('new', s.Timeline.link(movie)).percent).toBe(0)
        s.Timeline.view('new', s.Timeline.link(movie)).handler(40, 40, 100)
        expect(s.values.file_view_1.a.percent).toBe(80)
        expect(s.values.file_view_2.new.profile).toBe(2)
        s.Account.Permit.sync = false
        s.Timeline.read()
        expect(s.Timeline.view('local').percent).toBe(30)
        expect(s.Timeline.view('new', s.Timeline.link(movie)).percent).toBe(0)
    })

    it('does not re-send received updates or overwrite their author timestamp', ()=>{
        const s = setup()
        s.Timeline.update({hash: 'remote', percent: 70, time: 70, duration: 100, card: 'movie_42', updated: 123, received: true})
        expect(s.values.file_view_1.remote.updated).toBe(123)
        expect(s.Timeline.view('new', s.Timeline.link(movie)).percent).toBe(70)
        expect(s.Socket.send).not.toHaveBeenCalled()
    })

    it('keeps metadata when a legacy extension updates an existing linked hash', ()=>{
        const s = setup({'file_view_1': {same: progress('movie_42', 40)}})
        s.Timeline.view('same').handler(50, 50, 100)
        expect(s.values.file_view_1.same.card).toBe('movie_42')
        expect(s.Timeline.view('renamed', s.Timeline.link(movie)).percent).toBe(50)
    })

    it('does not leave a stale identity when a legacy hash is rebound to another card', ()=>{
        const s = setup({'file_view_1': {backup: progress('movie_42', 30, 1), shared: progress('movie_42', 50, 2)}})
        s.Timeline.update({hash: 'shared', card: 'movie_99', percent: 80})
        expect(s.Timeline.view('renamedOld', {card: 'movie_42'}).percent).toBe(30)
        expect(s.Timeline.view('renamedNew', {card: 'movie_99'}).percent).toBe(80)
    })

    it('clears old series coordinates when the same hash is rebound to a movie', ()=>{
        const s = setup({'file_view_1': {shared: {...progress('tv_42', 60), season: 1, episode: 2}}})
        s.Timeline.update({hash: 'shared', card: 'movie_99', percent: 80})
        expect(s.values.file_view_1.shared).not.toHaveProperty('season')
        expect(s.values.file_view_1.shared).not.toHaveProperty('episode')
        expect(s.Timeline.view('newHash', {card: 'movie_99'}).percent).toBe(80)
        expect(s.Timeline.view('oldHash', {card: 'tv_42', season: 1, episode: 2}).percent).toBe(0)
    })
})
