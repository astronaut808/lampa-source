import {describe,expect,it,vi} from 'vitest'
import {loadBrowserModule} from './helpers/browser_module'
import Subscribe from '../src/utils/subscribe'

function database(){
    const request={},transaction={objectStore:()=>({put:()=>request,delete:()=>request,clear:()=>request})}
    const DB=loadBrowserModule('src/utils/db.js',{Subscribe,console:{log:vi.fn()},Promise,Date})
    const db=new DB('cache',['storage'],7)
    db.db={transaction:()=>transaction}
    return {db,request,transaction}
}

describe('reserve durability boundary',()=>{
    it.each(['rewriteData','deleteData','clearTable'])('does not report %s request success as committed',async method=>{
        const s=database(),done=vi.fn()
        const promise=s.db[method]('storage','favorite',{value:'new'}).then(done)
        if(s.request.onsuccess)s.request.onsuccess()
        await new Promise(resolve=>setTimeout(resolve,0))
        expect(done).not.toHaveBeenCalled()
        s.transaction.oncomplete()
        await promise
        expect(done).toHaveBeenCalledOnce()
    })
    it.each(['rewriteData','deleteData','clearTable'])('rejects an abort after %s request success',async method=>{
        const s=database()
        const promise=s.db[method]('storage','favorite',{value:'new'})
        const rejected=expect(promise).rejects.toThrow('disk write aborted')
        if(s.request.onsuccess)s.request.onsuccess()
        s.transaction.error=new Error('disk write aborted')
        if(s.transaction.onabort)s.transaction.onabort()
        await rejected
    })
})
