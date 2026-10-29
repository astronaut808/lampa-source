import Torserver from '../../../torserver'
import Storage from '../../../../core/storage/storage'
import Base64 from '../../../../utils/base64'

/**
 * Доступ к файлам шрифтов торрента через TorrServer: список файлов, адрес и чтение диапазонов
 */

function base(){
    return String(Torserver.url() || '').replace(/\/+$/, '')
}

// Credentials stay in headers and are never passed to FontFace or the ASS worker.
function request(link, options, read){
    let server = new URL(base() + '/')
    let target = new URL(link)
    if(target.origin !== server.origin || target.pathname.indexOf(server.pathname) !== 0){
        return Promise.reject(new Error('font request outside TorrServer'))
    }
    let headers = Object.assign({}, options.headers)
    if(Storage.field('torrserver_auth')){
        headers.Authorization = 'Basic ' + Base64.encode(Storage.get('torrserver_login') + ':' + Storage.value('torrserver_password'))
    }
    let controller = typeof AbortController === 'function' ? new AbortController() : null
    let timer
    let timeout = new Promise((resolve, reject)=>{
        timer = setTimeout(()=>{
            if(controller) controller.abort()
            reject(new Error('font request timeout'))
        }, 8000)
    })
    let response = Promise.resolve().then(()=>fetch(link, Object.assign({}, options, {
        headers, redirect: 'error', signal: controller ? controller.signal : undefined
    }))).then(r=>{
        if(!r.ok) throw new Error('font request ' + r.status)
        return read(r)
    })
    return Promise.race([response, timeout]).finally(()=>clearTimeout(timer))
}

function listFiles(hash){
    return request(base() + '/torrents', {
        method: 'POST',
        body: JSON.stringify({action: 'get', hash: hash})
    }, r=>r.json()).then(json=>{
        return (json.file_stats || []).map(f=> ({id: f.id, path: f.path, length: f.length}))
    })
}

/**
 * Адрес файла как обычного потока (без gst-обработки)
 */
function url(hash, file){
    let name = String(file.path || '').split('/').pop()

    return base() + '/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + file.id + '&play'
}

function range(link, start, end){
    if(end <= start) return Promise.resolve(new Uint8Array(0))

    // cache: no-store - чтобы не получить из кэша браузера ответ, полученный в момент, когда сервер ещё не отдавал данные
    return request(link, {cache: 'no-store', headers: {Range: 'bytes=' + start + '-' + (end - 1)}}, r=>{
        return r.arrayBuffer().then(buf=>{
            let bytes = new Uint8Array(buf)

            // сервер проигнорировал Range и вернул файл целиком
            if(r.status === 200 && (start > 0 || bytes.length > end - start)) return bytes.subarray(start, end)

            return bytes
        })
    })
}

/**
 * Файл целиком (запасной путь, если чтение по диапазонам дало неполные данные)
 */
function full(link){
    return request(link, {cache: 'no-store'}, r=>r.arrayBuffer()).then(buf=> new Uint8Array(buf))
}

function asset(hash, file){
    let link = url(hash, file)
    if(!Storage.field('torrserver_auth')) return Promise.resolve({url: link})

    // Authenticated fonts must be materialized locally; cap individual allocations.
    const limit = 32 * 1024 * 1024
    if(file.length > limit) return Promise.reject(new Error('authenticated font exceeds size limit'))
    return request(link, {cache: 'no-store'}, r=>{
        if(Number(r.headers.get('Content-Length')) > limit) throw new Error('font exceeds size limit')
        return r.arrayBuffer()
    }).then(bytes=>{
        if(bytes.byteLength > limit) throw new Error('font exceeds size limit')
        let object = URL.createObjectURL(new Blob([bytes], {type: 'font/ttf'}))
        return {url: object, release: ()=>URL.revokeObjectURL(object)}
    })
}

export default {
    listFiles,
    url,
    range,
    full,
    asset
}
