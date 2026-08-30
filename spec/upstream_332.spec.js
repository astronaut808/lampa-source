import {describe, expect, it} from 'vitest'
import fs from 'node:fs'

const manifest = fs.readFileSync(new URL('../src/core/manifest.js', import.meta.url), 'utf8')
const player = fs.readFileSync(new URL('../src/interaction/player.js', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/interaction/player/panel.js', import.meta.url), 'utf8')
const params = fs.readFileSync(new URL('../src/interaction/settings/params.js', import.meta.url), 'utf8')
const torrent = fs.readFileSync(new URL('../src/interaction/torrent.js', import.meta.url), 'utf8')
const torserver = fs.readFileSync(new URL('../src/interaction/torserver.js', import.meta.url), 'utf8')

describe('upstream 3.3.2 integration', ()=>{
    it('reports the upstream application and stylesheet version', ()=>{
        expect(manifest).toContain("css_version: '3.3.2'")
        expect(manifest).toContain("app_version: '3.3.2'")
    })

    it('uses the public player volume API', ()=>{
        expect(panel).toContain('Video.volume($(this).val())')
        expect(panel).not.toContain('Video.changeVolume($(this).val())')
    })

    it('keeps TorrServer timecode synchronization opt-in', ()=>{
        expect(params).toContain("trigger('torrserver_tracktimecode', false)")
        expect(torrent).toContain("Storage.field('torrserver_tracktimecode')")
        expect(torserver).toContain('viewedSet')
    })

    it('does not retain full playback objects or stream URLs in logs', ()=>{
        expect(player).not.toContain("console.log('Player','play data', data)")
        expect(player).not.toContain("console.log('Player','item url', data.url)")
        expect(player).not.toContain("console.log('Player','play url', data.url)")
        expect(player).not.toContain("console.log('Player','quality selected url', quality_url)")
    })
})
