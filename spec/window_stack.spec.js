import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import Subscribe from '../src/utils/subscribe'
import {loadBrowserModule} from './helpers/browser_module'

beforeEach(()=>{vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))})
afterEach(()=>{vi.clearAllTimers(); vi.useRealTimers()})

function setup(){
    const roots = []
    class Box {
        constructor(name = '', length = 1){
            this.classes = new Set(name.split(' ').filter(Boolean))
            this.length = length
            this[0] = {attached: false}
            roots.push(this)
        }
        find(selector){return new Box('', /selector|selected|focus/.test(selector) ? 0 : 1)}
        on(){return this} css(){return this} text(){return this} data(){return this}
        append(child){if(child instanceof Box) child[0].attached = true; return this}
        prepend(child){return this.append(child)}
        remove(){this[0].attached = false; return this}
        addClass(name){this.classes.add(name); return this}
        removeClass(name){this.classes.delete(name); return this}
        toggleClass(name, value){value ? this.classes.add(name) : this.classes.delete(name); return this}
        hasClass(name){return this.classes.has(name)}
        offset(){return {top: 0}} outerHeight(){return 0} index(){return -1}
        eq(){return new Box('', 0)} empty(){return this}
    }
    const body = new Box()
    const $ = selector=>{
        if(selector === 'body') return body
        if(selector instanceof Box) return selector
        const match = roots.filter(root=>root[0].attached && String(selector).split(',').some(part=>root.hasClass(part.replace(/^\./, ''))))
        return {length: match.length, remove: ()=>match.forEach(root=>root.remove())}
    }
    const document = {body: {contains: node=>node.attached}}
    const Activity = {call: vi.fn(), mixState: vi.fn()}
    const Select = {}, Modal = {}
    const Player = {close: vi.fn()}
    const Console = {opened: ()=>false, close: vi.fn()}
    const contentBack = vi.fn(), Layer = {update: vi.fn(), visible: vi.fn()}
    const globals = {
        $, document, window: {innerWidth: 1920, innerHeight: 1080},
        console: {log: vi.fn(), error: vi.fn()},
        Subscribe, Activity, Select, Modal, Player, Console, Layer,
        Storage: {field: ()=>false}, Screensaver: {stopSlideshow: vi.fn()},
        setTimeout, clearTimeout, Date
    }
    const Controller = loadBrowserModule('src/core/controller.js', globals)
    // Layout and physical focus are browser boundaries; navigation logic stays real.
    Controller.collectionSet = vi.fn()
    Controller.collectionFocus = vi.fn()
    Controller.add('content', {back: contentBack})
    Controller.toggle('content')
    class Scroll {
        constructor(){this.root = new Box(); this.destroy = vi.fn()}
        render(){return this.root} body(){return this.root}
        append(){return this} addSwipeDown(){} clear(){} reset(){}
    }
    const uiGlobals = {
        ...globals, Controller, Scroll,
        Platform: {mouse: ()=>false}, DeviceInput: {},
        Template: {get: name=>new Box(name === 'modal' ? 'modal' : 'selectbox')}
    }
    Object.assign(Modal, loadBrowserModule('src/interaction/modal.js', uiGlobals))
    Object.assign(Select, loadBrowserModule('src/interaction/select.js', uiGlobals))
    Select.init()
    return {Controller, Modal, Select, Box, roots, body, contentBack, Player,
        modal(params = {}){Modal.open({title: 'Window', html: new Box(), ...params})},
        select(params = {}){Select.show({title: 'Options', items: [], ...params})}}
}

describe('window stack and legacy extension controllers', ()=>{
    it('keeps legacy plugin controllers and their back handlers', ()=>{
        const s = setup(), back = vi.fn()
        s.Controller.add('lampac', {back})
        s.Controller.toggle('lampac')
        s.Controller.back()
        expect(back).toHaveBeenCalledTimes(1)
        expect(s.Controller.enabled().name).toBe('lampac')
    })

    it('restores a parent modal when an extension closes the child and toggles content', ()=>{
        const s = setup()
        s.modal()
        const parent = s.Modal.render()
        s.modal({onBack: ()=>{s.Modal.close(); s.Controller.toggle('content')}})
        s.Controller.back()
        expect(s.Modal.render()).toBe(parent)
        expect(parent.hasClass('hide')).toBe(false)
        expect(parent[0].attached).toBe(true)
        expect(s.Controller.enabled().name).toBe('modal')
        expect(s.Controller.windowTop().name).toBe('modal')
        expect(s.contentBack).not.toHaveBeenCalled()
    })

    it('returns from a select to the modal underneath instead of removing it', ()=>{
        const s = setup()
        s.modal()
        const parent = s.Modal.render()
        s.select({onBack: ()=>s.Controller.toggle('content')})
        s.Controller.back()
        expect(s.Select.opened()).toBe(false)
        expect(parent[0].attached).toBe(true)
        expect(s.Controller.enabled().name).toBe('modal')
    })

    it('retains a replacement modal opened synchronously by a close listener', ()=>{
        const s = setup()
        s.modal()
        let replacement
        s.Modal.listener.follow('close', ()=>{
            if(replacement) return
            s.modal({title: 'Replacement'})
            replacement = s.Modal.render()
        })
        s.Modal.close()
        expect(s.Modal.render()).toBe(replacement)
        expect(replacement[0].attached).toBe(true)
        expect(s.Controller.windowTop().name).toBe('modal')
        s.Modal.closeAll()
        expect(replacement[0].attached).toBe(false)
        expect(s.Controller.windowTop()).toBe(false)
    })

    it('keeps the restored parent registered when its draw callback inspects the window stack', ()=>{
        const s = setup()
        s.select({onFullDraw: ()=>s.Controller.windowTop()})
        const parent = s.Controller.windowTop()
        s.select()
        s.Select.close()
        expect(s.Select.opened()).toBe(true)
        expect(s.Controller.windowTop()).toBe(parent)
        expect(s.Controller.enabled().name).toBe('select')
    })

    it('keeps the parent registered while public close listeners run', ()=>{
        const s = setup()
        s.select()
        const parent = s.Controller.windowTop()
        s.select()
        s.Select.listener.follow('close', ()=>s.Controller.windowTop())
        s.Select.close()
        expect(s.Select.opened()).toBe(true)
        expect(s.Controller.windowTop()).toBe(parent)
    })

    it('publishes closeAll events after clearing old modal frames', ()=>{
        const s = setup()
        s.modal(); s.modal()
        let replacement
        s.Modal.listener.follow('close', ()=>{
            if(replacement) return
            s.modal({title: 'Replacement'})
            replacement = s.Modal.render()
        })
        s.Modal.closeAll()
        expect(s.Modal.render()).toBe(replacement)
        expect(s.roots.filter(root=>root.hasClass('modal') && root[0].attached)).toEqual([replacement])
        s.Modal.closeAll()
        expect(s.roots.filter(root=>root.hasClass('modal') && root[0].attached)).toHaveLength(0)
        expect(s.Controller.windowTop()).toBe(false)
    })

    it('restores a parent select and its callback after closing the child', ()=>{
        const s = setup(), parentBack = vi.fn()
        s.select({onBack: parentBack})
        s.select({onBack: ()=>s.Controller.toggle('content')})
        s.Controller.back()
        expect(s.Select.opened()).toBe(true)
        expect(s.Controller.enabled().name).toBe('select')
        expect(parentBack).not.toHaveBeenCalled()
        vi.advanceTimersByTime(501)
        s.Controller.back()
        expect(parentBack).toHaveBeenCalledTimes(1)
        expect(s.Select.opened()).toBe(false)
        expect(s.Controller.windowTop()).toBe(false)
    })

    it('does not resurrect a parent select when onBack opens a replacement', ()=>{
        const s = setup(), parentBack = vi.fn(), replacementBack = vi.fn()
        s.select({onBack: parentBack})
        s.select({onBack: ()=>s.select({onBack: replacementBack})})
        s.Controller.back()
        expect(s.Select.opened()).toBe(true)
        vi.advanceTimersByTime(501)
        s.Controller.back()
        expect(replacementBack).toHaveBeenCalledTimes(1)
        expect(parentBack).not.toHaveBeenCalled()
        expect(s.Select.opened()).toBe(false)
        expect(s.Controller.windowTop()).toBe(false)
    })

    it('closeAll removes nested modals and selects without invoking onBack', ()=>{
        const s = setup(), onBack = vi.fn()
        s.modal({onBack}); s.modal({onBack})
        s.select({onBack}); s.select({onBack})
        s.Select.closeAll(); s.Modal.closeAll()
        expect(onBack).not.toHaveBeenCalled()
        expect(s.Select.opened()).toBe(false)
        expect(s.roots.filter(root=>root.hasClass('modal') && root[0].attached)).toHaveLength(0)
        expect(s.Controller.windowTop()).toBe(false)
    })

    it('ignores detached window entries when deciding the top window', ()=>{
        const s = setup()
        const base = s.Controller.windowOpen('plugin', ()=>true)
        s.Controller.windowOpen('stale', ()=>false)
        expect(s.Controller.windowTop()).toBe(base)
        s.Controller.windowClose(base, true)
        expect(s.Controller.windowTop()).toBe(false)
    })

    it('does not redirect an unrelated controller after a child closes', ()=>{
        const s = setup()
        s.Controller.add('player', {})
        s.modal(); s.modal()
        s.Modal.close()
        s.Controller.toggle('player')
        expect(s.Controller.enabled().name).toBe('player')
    })

    it('triple back closes stuck overlays without walking the content history', ()=>{
        const s = setup()
        s.modal({onBack: vi.fn()})
        s.Controller.back(); s.Controller.back(); s.Controller.back()
        expect(s.Controller.enabled().name).toBe('content')
        expect(s.Controller.windowTop()).toBe(false)
        expect(s.roots.filter(root=>root.hasClass('modal') && root[0].attached)).toHaveLength(0)
        expect(s.contentBack).not.toHaveBeenCalled()
    })

    it('triple back without overlays retains normal content navigation', ()=>{
        const s = setup()
        s.Controller.back(); s.Controller.back(); s.Controller.back()
        expect(s.contentBack).toHaveBeenCalledTimes(3)
    })

    it('does not treat slow back presses as a triple-click escape', ()=>{
        const s = setup(), onBack = vi.fn()
        s.modal({onBack})
        s.Controller.back(); vi.advanceTimersByTime(501)
        s.Controller.back(); vi.advanceTimersByTime(501)
        s.Controller.back()
        expect(onBack).toHaveBeenCalledTimes(3)
        expect(s.Controller.enabled().name).toBe('modal')
    })

    it('force-closing overlays while focused on content does not navigate backwards', ()=>{
        const s = setup()
        s.modal(); s.modal()
        // A plugin may have lost focus without removing its overlay.
        s.Controller.add('head', {back: s.contentBack})
        s.Controller.toggle('head')
        s.Controller.toggle('content', true)
        expect(s.contentBack).not.toHaveBeenCalled()
        expect(s.Controller.windowTop()).toBe(false)
        expect(s.Controller.enabled().name).toBe('content')
    })
})
