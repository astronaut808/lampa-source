import Reguest from '../../utils/reguest'
import Lang from '../../core/lang'
import Torserver from '../torserver'
import Player from '../player'
import Panel from './panel'
import Video from './video'
import SubsTorserver from './subtitles/torserver'
import {languageName, channelLayout} from './track_info'
import {parseGst} from './playback_info'
import Platform from '../../core/platform'
import Storage from '../../core/storage/storage'

/**
 * Выбор аудиодорожки при воспроизведении торрента через транскодирование TorrServer (gstreamer).
 * HLS-поток после транскодирования содержит одну аудиодорожку, поэтому список берём из файла:
 *  - GET /gst/{hash}/probe?index=N  - дорожки файла
 * Дорожка задаётся параметром &audio=I в адресе потока (I - номер среди аудиодорожек, с 0).
 * При выборе адрес меняется и перезапускается только видео (как при смене качества), позиция сохраняется.
 */

let probe_net = new Reguest()
let active    = false
let session   = 0
let transition = null
let revision = 0
let switching = false

function init(){
    Player.listener.follow('start', start)
    Player.listener.follow('destroy', stop)
    Video.listener.follow('destroy', ()=>{if(!switching) seekCancel()})
    Video.listener.follow('error', e=>{if(e.fatal) seekCancel()})
    Video.listener.follow('astronaut:command', e=>{
        if(!transition || e.reason === 'seek' || e.reason === 'source_load') return
        if(e.action === 'pause') transition.paused = true
        if(e.action === 'play') transition.paused = false
    })
}

/**
 * Список дорожек в панели задан этим модулем: дорожки из видео его не перезаписывают
 * @returns {boolean}
 */
function isActive(){
    return active
}

function isGst(data){
    return Boolean(data && data.torrent_hash && String(data.url || '').indexOf('/gst/') >= 0)
}

function currentAudio(url){
    let m = /[?&]audio=(\d+)/.exec(String(url || ''))

    return m ? parseInt(m[1]) : 0
}

/**
 * Адрес потока с нужной дорожкой: параметр audio заменяется или добавляется
 */
function withAudio(url, index){
    url = String(url || '')

    if(/[?&]audio=\d*/.test(url)) return url.replace(/([?&]audio=)\d*/, '$1' + index)

    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'audio=' + index
}

function seekCancel(){
    revision++
    if(transition){
        Video.listener.remove('loadeddata', transition.loaded)
        clearTimeout(transition.timer)
    }
    transition = null
}

function stop(){
    session++

    active = false

    probe_net.clear()

    seekCancel()
}

function trackLabel(tr){
    let parts = [tr.codec, channelLayout(tr.channels), tr.rate ? tr.rate / 1000 + ' kHz' : '']

    if(tr.title) parts.push(tr.title)

    return parts.filter(Boolean).join(' · ')
}

/**
 * Перезапустить видео с другой дорожкой и вернуться на прежнее место
 */
function switchAudio(data, index){
    let video = Video.video()
    if(!video) return
    // A second selection must reuse the original position, not the new source's temporary zero.
    let previous = transition
    let state = {
        time: previous ? previous.time : Math.max(0, Number(video.currentTime) || 0),
        paused: previous ? previous.paused : Boolean(video.paused),
        subtitles: previous ? previous.subtitles : !Video.render().find('.player-video__subtitles').hasClass('hide'),
        subtitleIndex: previous ? previous.subtitleIndex : Array.from(video.customSubs || video.textTracks || []).findIndex(sub=>sub.mode === 'showing' || sub.selected)
    }

    seekCancel()
    let mine = revision
    let playerSession = session
    const current = ()=>mine === revision && playerSession === session && Player.playdata() === data
    data.url = withAudio(data.url, index)
    state.loaded = ()=>{
        if(!current()) return
        if(state.time > 0) Video.to(state.time)
        if(!current()) return
        if(state.paused) Video.pause('audio_switch')
        if(!current()) return
        Video.subsview(state.subtitles)
        if(current()){
            clearTimeout(state.timer)
            Video.listener.remove('loadeddata', state.loaded)
            transition = null
        }
    }
    transition = state
    Video.listener.follow('loadeddata', state.loaded)
    state.timer = setTimeout(()=>{
        if(!current()) return
        Video.listener.remove('loadeddata', state.loaded)
        transition = null
    }, 65000)
    // Retain the element and its native subtitle/ASS bindings, not just its timestamp.
    switching = true
    try{
        Video.destroy(true, true)
        if(!current()) return
        Video.subsview(state.subtitles)
        Video.url(Torserver.toPlayUrl(data.url), true, current, {
            paused: state.paused, subtitlesVisible: state.subtitles, subtitleIndex: state.subtitleIndex
        })
    }
    catch(error){
        if(current()){
            seekCancel()
            Video.listener.send('error', {error: Lang.translate('player_error_one'), fatal: true})
        }
    }
    finally{switching = false}
}

function start(data){
    stop()

    if(!isGst(data) || data.voiceovers || !Torserver.url()) return
    // AVPlay OBJECT wrappers have a different close/open/pause contract; retain their existing track path.
    if((Platform.is('tizen') && Storage.field('player') === 'tizen') ||
       (Platform.is('orsay') && Storage.field('player') === 'orsay')) return

    let id = SubsTorserver.fileIndex(data)

    if(id < 0) return

    let mine = session

    probe_net.timeout(8000)

    probe_net.silent(Torserver.url() + '/gst/' + encodeURIComponent(data.torrent_hash) + '/probe?index=' + id, (json)=>{
        if(mine !== session) return
        const video = Video.video()
        if(!video || String(video.tagName || video.nodeName || '').toUpperCase() !== 'VIDEO') return

        let probe
        try{probe = parseGst(json)}catch(error){return}
        let audio = probe ? probe.tracks.filter(tr=>tr.type == 'audio') : []

        if(audio.length < 2) return

        let selected = currentAudio(data.url)

        if(!audio[selected]) selected = 0

        // onSelect у пункта не задаём: Select вызвал бы его вместо обработчика панели (отметка и возврат фокуса).
        // Панель включает дорожку через enabled = true, как у HLS-дорожек (video/hls.js)
        let tracks = audio.map((tr, index)=>{
            let item = {
                language: tr.lang ? languageName(tr.lang, Lang.translate, '') : '',
                label: trackLabel(tr),
                selected: index == selected,
                ignore_translate: true
            }

            Object.defineProperty(item, 'enabled', {
                set: (v)=>{
                    if(!v || index == selected || mine !== session) return

                    selected = index

                    switchAudio(data, index)
                },
                get: ()=> index == selected
            })

            return item
        })

        active = true

        Panel.setTracks(tracks)
    }, false, false, {dataType: 'json'})
}

export default {
    init,
    isActive
}
