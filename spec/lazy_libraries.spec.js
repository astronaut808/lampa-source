import {afterEach, expect, suite, test, vi} from 'vitest'

vi.mock('../src/utils/utils', () => ({
    default: {
        protocol: () => 'https://',
        putScriptAsync: () => {}
    }
}))

vi.mock('../src/core/manifest', () => ({
    default: {
        github_lampa: 'https://example.test/',
        cub_domain: 'cub.test'
    }
}))

import Libs from '../src/services/libs'

suite('lazy libraries', () => {
    let originalWindow = global.window
    let originalDocument = global.document

    afterEach(() => {
        global.window = originalWindow
        global.document = originalDocument
    })

    test('loads HLS once for concurrent consumers', () => {
        let scripts = []
        let completed = 0

        global.window = {
            location: {
                protocol: 'http:',
                href: 'http://lampa.local/'
            }
        }
        global.document = {
            createElement: () => ({}),
            body: {
                appendChild: script => scripts.push(script)
            }
        }

        Libs.load('hls', () => completed++)
        Libs.load('hls', () => completed++)

        expect(scripts).toHaveLength(1)
        expect(scripts[0].src).toBe('./vender/hls/hls.js')

        global.window.Hls = function(){}
        scripts[0].onload()

        expect(completed).toBe(2)
    })

    test('reports an unknown library without adding a script', () => {
        let error

        global.window = {
            location: {
                protocol: 'http:',
                href: 'http://lampa.local/'
            }
        }
        global.document = {
            createElement: () => ({}),
            body: {
                appendChild: () => {}
            }
        }

        Libs.load('unknown', () => {}, value => error = value)

        expect(error.message).toContain('Unknown library')
    })
})
