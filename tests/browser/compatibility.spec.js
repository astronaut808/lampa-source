const {test, expect} = require('@playwright/test')

const movie = {id: 101, title: 'Smoke movie', original_title: 'Smoke movie', overview: 'A deterministic test card.',
    media_type: 'movie', release_date: '2020-01-01', vote_average: 7, vote_count: 100,
    poster_path: '/poster.svg', backdrop_path: null, genre_ids: [18], adult: false}
const forbidden = /\/api\/metric\/|\/api\/extensions\/install|\/api\/ad\/|personal\.lampa|google-analytics\.com|googletagmanager\.com|\/plugin\/(shots|engineer|halloween|black-friday|snow|new-year|womens-day)(?:[/?]|$)/

async function boot(page, {telemetry = false, detailsStatus = 200, optionalDelay = 0, detailsDelay = 0} = {}){
    const requests = [], errors = []
    page.on('request', request=>requests.push(request.url()))
    page.on('pageerror', error=>errors.push(error.message))
    await page.addInitScript(()=>{
        localStorage.setItem('language','en')
        localStorage.setItem('tmdb_lang','en')
        localStorage.setItem('source','tmdb')
        window.lampa_settings = {socket_use:false, geo:false, mirrors:false, demo:false, white_use:false}
    })
    await page.route('**/*', async route=>{
        const url = new URL(route.request().url())
        const local = url.origin === new URL(test.info().project.use.baseURL || process.env.LAMPA_TEST_URL || 'http://127.0.0.1:18090').origin
        const json = (data, status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
        if(local && url.pathname === '/runtime-config.js' && telemetry){
            return route.fulfill({contentType:'application/javascript',body:'window.LampaRuntimeConfig={cubTelemetryEnabled:true,builtinAdsEnabled:false,shotsEnabled:false,seasonalEventsEnabled:false,postPlaybackReactionsEnabled:false}'})
        }
        if(local && url.pathname === '/plugins_black_list.json') return json([])
        if(local && url.pathname === '/plugins/modification.js') return route.fulfill({contentType:'application/javascript',body:''})
        if(local) return route.continue()
        if(url.pathname.startsWith('/3/')){
            if(/\/credits$/.test(url.pathname)) return json({cast:[],crew:[]})
            if(/\/movie\/(101|404)$/.test(url.pathname)){
                if(detailsDelay) await new Promise(resolve=>setTimeout(resolve,detailsDelay))
                if(page.isClosed()) return
                return json({...movie,id:Number(url.pathname.split('/').pop()),runtime:100,genres:[],production_countries:[],production_companies:[],spoken_languages:[],belongs_to_collection:null,
                    keywords:{keywords:[]},external_ids:{},images:{backdrops:[],posters:[]}}, detailsStatus)
            }
            if(/\/videos$|\/recommendations$|\/similar$/.test(url.pathname)) return json({results:[]})
            return json({results:[movie],page:1,total_pages:1,total_results:1})
        }
        if(url.pathname.includes('/api/plugins/blacklist')) return json([])
        if(url.pathname.includes('/api/reactions/') || url.pathname.includes('/metadata')){
            if(optionalDelay) await new Promise(resolve=>setTimeout(resolve, optionalDelay))
            if(page.isClosed()) return
            return json({result:[],status:'pending'})
        }
        if(url.pathname.includes('/api/history/list')) return json({history:[{card:movie,views:1}],page:1,total_pages:1,total:1})
        if(url.pathname.includes('/api/metric/')) return json({})
        if(url.pathname.endsWith('.svg') || /image\.tmdb|b-cdn/.test(url.hostname)){
            return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#284a68"/></svg>'})
        }
        if(route.request().resourceType() === 'script') return route.fulfill({contentType:'application/javascript',body:''})
        return json({results:[],result:[]})
    })
    await page.goto('/?component=main&source=tmdb&page=1')
    await expect(page.locator('.welcome')).toHaveCount(0)
    await expect(page.locator('.card__title').filter({hasText:'Smoke movie'}).first()).toBeVisible()
    return {requests,errors}
}

test('catalog, card and Back work while optional enrichment is delayed', async({page})=>{
    const s = await boot(page,{optionalDelay:2000})
    await page.locator('.card').first().click()
    await expect(page.locator('.full-start-new__title')).toHaveText('Smoke movie')
    await page.evaluate(()=>Lampa.Activity.back())
    await expect(page.locator('.card__title').filter({hasText:'Smoke movie'}).first()).toBeVisible()
    await expect(page.locator('.full-start-new__title')).toHaveCount(0)
    await page.waitForTimeout(2100)
    expect(s.errors).toEqual([])
    expect(s.requests.filter(url=>forbidden.test(url))).toEqual([])
    expect(s.requests.filter(url=>/vender\/jassub\//.test(url))).toEqual([])
})

test('a 404 details response ends loading instead of leaving a spinner', async({page})=>{
    const s = await boot(page,{detailsStatus:404})
    await page.evaluate(()=>Lampa.Activity.push({component:'full',id:404,method:'movie',source:'tmdb'}))
    await expect(page.locator('.empty').last()).toBeVisible()
    await expect(page.locator('.activity__loader:visible')).toHaveCount(0)
    expect(s.errors).toEqual([])
})

for(const detailsStatus of [200,404]){
    test('Back ignores delayed details with status '+detailsStatus,async({page})=>{
        const s=await boot(page,{detailsDelay:1500,detailsStatus})
        await page.evaluate(()=>Lampa.Activity.push({component:'full',id:101,method:'movie',source:'tmdb'}))
        await expect.poll(()=>s.requests.some(url=>/\/3\/movie\/101\?/.test(url))).toBe(true)
        await page.evaluate(()=>Lampa.Activity.back())
        await page.waitForTimeout(1700)
        expect(await page.evaluate(()=>Lampa.Activity.active().component)).toBe('main')
        await expect(page.locator('.full-start-new__title')).toHaveCount(0)
        expect(s.errors).toEqual([])
    })
}

test('telemetry positive control proves the request observer sees the enabled path', async({page})=>{
    const s = await boot(page,{telemetry:true})
    await expect.poll(()=>s.requests.filter(url=>/\/api\/metric\//.test(url)).length).toBeGreaterThan(0)
    expect(s.errors).toEqual([])
})

test('disabled telemetry does not prevent explicit CUB history access', async({page})=>{
    const s = await boot(page)
    const total = await page.evaluate(()=>new Promise((resolve,reject)=>{
        Lampa.Storage.set('account',{token:'browser-fixture-only',profile:{id:7}},true)
        Lampa.Account.Api.watchHistory({page:1},data=>resolve(data.total),()=>reject(new Error('fixture history failed')))
    }))
    expect(total).toBe(1)
    expect(s.requests.some(url=>url.includes('/api/history/list'))).toBe(true)
    expect(s.requests.filter(url=>forbidden.test(url))).toEqual([])
    expect(s.errors).toEqual([])
})

async function overflowingPreference(page,key,value){
    await page.evaluate(({key,value})=>{
        const original=Storage.prototype.setItem
        Storage.prototype.setItem=function(name,data){
            if(name===key)throw new DOMException('fixture quota','QuotaExceededError')
            return original.call(this,name,data)
        }
        try{Lampa.Storage.set(key,value)}
        finally{Storage.prototype.setItem=original}
    },{key,value})
    await expect.poll(()=>page.evaluate(key=>Lampa.Cache.getData('storage',key).then(row=>row && row.value),key)).toBe(JSON.stringify(value))
}

async function reloadedCatalog(page){
    await page.reload()
    await expect(page.locator('.card__title').filter({hasText:'Smoke movie'}).first()).toBeVisible()
}

test('reserved settings survive reload, a local replacement and erase',async({page})=>{
    const s=await boot(page),key='astronaut_preferences_probe'
    const saved={source:'fixture',favorite:[101],progress:{seconds:1234},enabled:false}
    await overflowingPreference(page,key,saved)
    await reloadedCatalog(page)
    expect(await page.evaluate(key=>Lampa.Storage.get(key),key)).toEqual(saved)
    await page.evaluate(key=>Lampa.Storage.set(key,{updated:true}),key)
    await expect.poll(()=>page.evaluate(key=>Lampa.Cache.getData('storage',key),key)).toBe(null)
    await reloadedCatalog(page)
    expect(await page.evaluate(key=>Lampa.Storage.get(key),key)).toEqual({updated:true})
    await overflowingPreference(page,key,{eraseFromReserve:true})
    await reloadedCatalog(page)
    await page.evaluate(key=>Lampa.Storage.erase(key),key)
    await expect.poll(()=>page.evaluate(key=>Lampa.Cache.getData('storage',key),key)).toBe(null)
    await reloadedCatalog(page)
    expect(await page.evaluate(key=>Lampa.Storage.get(key,'missing'),key)).toBe('missing')
    expect(s.errors).toEqual([])
    expect(s.requests.filter(url=>forbidden.test(url))).toEqual([])
})

test('cache cleanup keeps reserved preferences in real IndexedDB',async({page})=>{
    const s=await boot(page),key='astronaut_preferences_probe'
    const saved={syncEnabled:true,provider:'fixture'}
    await overflowingPreference(page,key,saved)
    await page.evaluate(()=>Lampa.Cache.clearAll(['storage']))
    await reloadedCatalog(page)
    expect(await page.evaluate(key=>Lampa.Storage.get(key),key)).toEqual(saved)
    expect(s.errors).toEqual([])
})

test('a real IndexedDB transaction abort retains the old local value',async({page})=>{
    const s=await boot(page),key='astronaut_abort_probe'
    const outcome=await page.evaluate(async key=>{
        Lampa.Storage.set(key,'old')
        const originalSet=Storage.prototype.setItem
        const db=Lampa.Cache.db,originalTransaction=db.transaction
        let requestSucceeded=false
        Storage.prototype.setItem=function(name,value){
            if(name===key)throw new DOMException('fixture quota','QuotaExceededError')
            return originalSet.call(this,name,value)
        }
        db.transaction=function(...args){
            const tx=originalTransaction.apply(this,args)
            if(args[1]==='readwrite' && Array.from(args[0]).includes('storage')){
                const originalStore=tx.objectStore
                tx.objectStore=function(name){
                    const store=originalStore.call(this,name),originalPut=store.put
                    store.put=function(...values){
                        const request=originalPut.apply(this,values)
                        request.addEventListener('success',()=>{requestSucceeded=true;tx.abort()},{once:true})
                        return request
                    }
                    return store
                }
            }
            return tx
        }
        try{
            const restored=await Lampa.Storage.restore(key,'new')
            return {restored,requestSucceeded,local:localStorage.getItem(key),value:Lampa.Storage.get(key)}
        }
        finally{
            Storage.prototype.setItem=originalSet
            db.transaction=originalTransaction
        }
    },key)
    expect(outcome).toEqual({restored:false,requestSucceeded:true,local:'old',value:'old'})
    await reloadedCatalog(page)
    expect(await page.evaluate(key=>Lampa.Storage.get(key),key)).toBe('old')
    expect(s.errors).toEqual([])
})

test.afterEach(async({page},info)=>{
    if(info.status !== info.expectedStatus){
        await info.attach('page-state',{body:Buffer.from(await page.locator('body').innerText()),contentType:'text/plain'})
    }
})
