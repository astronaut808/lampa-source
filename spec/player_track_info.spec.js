import {describe, expect, test} from 'vitest'
import {channelLayout, codecName, languageCode, languageName, preferredSubtitle, tracksFromFfprobe} from '../src/interaction/player/track_info'

describe('Player audio track info', () => {
    test('formats the raw Tizen values like Kodi', () => {
        let translate = key=>key == 'filter_lang_uk' ? 'Українська' : key

        expect(languageCode('ukr')).toBe('uk')
        expect(languageName('ukr', translate, 'Невідомо')).toBe('Українська')
        expect(codecName('audio/x-ac3')).toBe('Dolby Digital')
        expect(channelLayout(6)).toBe('5.1')
    })

    test('uses Kodi-style names for common codecs', () => {
        expect(codecName('eac3')).toBe('Dolby Digital+')
        expect(codecName('A_DTS')).toBe('DTS')
        expect(codecName('truehd_atmos')).toBe('TrueHD · Atmos')
        expect(channelLayout('stereo')).toBe('2.0')
    })

    test('takes the voice studio description from the MKV track title', () => {
        expect(tracksFromFfprobe([{
            index: 11,
            codec_type: 'audio',
            codec_name: 'ac3',
            channels: 6,
            tags: {language: 'ukr', title: 'DniproFilm'}
        }])).toEqual([{
            language: 'ukr',
            label: 'DniproFilm',
            extra: {channels: 6, fourCC: 'ac3'}
        }])
    })

    test('does not show generic container handler names as a studio', () => {
        expect(tracksFromFfprobe([{
            codec_type: 'audio',
            tags: {language: 'eng', handler_name: 'SoundHandler'}
        }])[0].label).toBe('')
    })
})

describe('Player preferred subtitle language', () => {
    test.each(['es', 'es-ES', 'spa'])('selects the requested language %s', code => {
        const russian = {language: 'rus', label: 'Полные'}
        const spanish = {srclang: 'es', label: 'Spanish'}

        expect(preferredSubtitle([russian, spanish], code)).toBe(spanish)
    })

    test('prefers full subtitles within the requested language', () => {
        const forced = {lang: 'eng', label: 'Forced'}
        const full = {language: 'en-US', label: 'Полные'}

        expect(preferredSubtitle([forced, full], 'en')).toBe(full)
    })

    test('preserves legacy Russian full-subtitle selection when tags are missing', () => {
        const first = {language: 'ru', label: 'Forced'}
        const full = {label: 'Полные'}

        expect(preferredSubtitle([first, full], 'ru')).toBe(full)
    })

    test('does not prefer a full subtitle explicitly tagged with another language over Russian', () => {
        const russian = {language: 'ru', label: 'Русские'}
        const english = {language: 'en', label: 'Полные'}

        expect(preferredSubtitle([russian, english], 'ru')).toBe(russian)
    })

    test('falls back to legacy full or first selection if the language is unavailable', () => {
        const first = {language: 'en', label: 'English'}
        const full = {language: 'ru', label: 'Полные'}

        expect(preferredSubtitle([first, full], 'de')).toBe(full)
        expect(preferredSubtitle([first], 'de')).toBe(first)
    })

    test('normalizes Ukrainian aliases used by extensions', () => {
        const ukrainian = {lang: 'ukr', label: 'Українська'}

        expect(preferredSubtitle([{language: 'en'}, ukrainian], 'ua')).toBe(ukrainian)
    })

    test.each([
        ['zh|cn', 'zho'],
        ['zh|cn', 'cn'],
        ['no|nb|nn', 'nb'],
        ['no|nb|nn', 'nn']
    ])('accepts the existing settings option %s for track %s', (code, language) => {
        const chosen = {language}

        expect(preferredSubtitle([{language: 'en'}, chosen], code)).toBe(chosen)
    })

    test('handles empty tracks and retains original track objects without changing them', () => {
        const track = Object.freeze({language: 'en', mode: 'disabled', selected: false})

        expect(preferredSubtitle([], 'en')).toBeUndefined()
        expect(preferredSubtitle([null, undefined, track], 'en')).toBe(track)
        expect(track.mode).toBe('disabled')
        expect(track.selected).toBe(false)
    })
})
