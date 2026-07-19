import Utils from '../utils/utils'
import Manifest from '../core/manifest'

let requests = {}

let libraries = {
    hls: {
        file: 'hls/hls.js',
        ready: ()=>typeof window.Hls !== 'undefined'
    },
    dash: {
        file: 'dash/dash.js',
        ready: ()=>typeof window.dashjs !== 'undefined'
    },
    youtube: {
        url: 'https://www.youtube.com/iframe_api',
        ready: ()=>typeof window.YT !== 'undefined' && typeof window.YT.Player !== 'undefined'
    }
}

function libraryUrl(library){
    if(library.url) return library.url

    if(window.location.protocol == 'file:' || window.location.href.indexOf('chrome-extension') > -1){
        return Manifest.github_lampa + 'vender/' + library.file
    }

    return './vender/' + library.file
}

/**
 * Загружает тяжёлую библиотеку при первом обращении и объединяет параллельные запросы.
 * @param {string} name - hls, dash или youtube
 * @param {function} complete - вызывается после успешной загрузки
 * @param {function} error - вызывается при ошибке
 */
function load(name, complete, error){
    let library = libraries[name]

    if(!library) return error && error(new Error('Unknown library: ' + name))
    if(library.ready()) return complete && complete()

    if(requests[name]){
        requests[name].push({complete, error})
        return
    }

    requests[name] = [{complete, error}]

    let script = document.createElement('script')
        script.async = true
        script.src = libraryUrl(library)

    let done = false
    let timeout = setTimeout(()=>finish(false), 15000)

    let finish = (success)=>{
        if(done) return

        done = true

        clearTimeout(timeout)

        let listeners = requests[name] || []

        delete requests[name]

        listeners.forEach(listener=>{
            if(success){
                if(listener.complete) listener.complete()
            }
            else if(listener.error) listener.error(new Error('Failed to load library: ' + name))
        })
    }

    script.onload = ()=>finish(library.ready())
    script.onerror = ()=>finish(false)

    document.body.appendChild(script)
}

/**
 * Инициализация дополнительных библиотек
 * @returns {void}
 */
function init(){
    let include = []

    // Плагины различные
    if(!window.lampa_settings.iptv && window.lampa_settings.services){
        include.push(Utils.protocol() + Manifest.cub_domain + '/plugin/sport')
        include.push(Utils.protocol() + Manifest.cub_domain + '/plugin/tsarea')
    }

    // Плагин Shots
    if(window.location.hostname !== 'localhost' && !window.lampa_settings.iptv) include.push(Utils.protocol() + Manifest.cub_domain + '/plugin/shots')

    Utils.putScriptAsync(include,()=>{})
}

export default {
    init,
    load
}
