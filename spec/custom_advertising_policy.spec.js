import { expect, suite, test } from 'vitest'
import {
    canShowBuiltinPreroll,
    shouldInitializeBuiltinAds
} from '../src/custom/advertising_policy'
import fs from 'node:fs'

const banner = fs.readFileSync(new URL('../src/interaction/advert/banner.js', import.meta.url), 'utf8')

suite('custom advertising policy', () => {
    const states = [
        {name: 'regular video', excludedMedia: false},
        {name: 'IPTV', excludedMedia: true},
        {name: 'torrent', excludedMedia: true},
        {name: 'premium account', excludedMedia: false, hasPremium: true},
        {name: 'personal confirmation', excludedMedia: false, personalConfirmed: true},
        {name: 'developer ads setting', excludedMedia: false, developerAdsEnabled: true}
    ]

    states.forEach(({name, ...state}) => {
        test(`disables preroll for ${name}`, () => {
            expect(canShowBuiltinPreroll({
                developerAdsEnabled: false,
                hasPremium: false,
                personalConfirmed: false,
                ...state
            })).toBe(false)
        })
    })

    test('does not initialize the built-in advertising manager', () => {
        expect(shouldInitializeBuiltinAds()).toBe(false)
    })

    test('blocks plugin VAST banners before any advertising manager starts', () => {
        expect(banner).toContain("import { shouldInitializeBuiltinAds } from '../../custom/advertising_policy'")
        expect(banner).toMatch(/function init\(\)\{\s*[^]*if\(!shouldInitializeBuiltinAds\(\)\) return/)
        expect(banner.indexOf('if(!shouldInitializeBuiltinAds()) return')).toBeLessThan(banner.indexOf('Manager.init()'))
    })
})
