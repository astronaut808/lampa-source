import { expect, suite, test } from 'vitest'
import {
    canShowBuiltinPreroll,
    shouldInitializeBuiltinAds
} from '../src/custom/advertising_policy'

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
})
