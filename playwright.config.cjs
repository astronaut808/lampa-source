const {defineConfig} = require('@playwright/test')

module.exports = defineConfig({
    testDir: './tests/browser',
    timeout: 25000,
    globalTimeout: 180000,
    workers: 1,
    retries: 0,
    reporter: [['list'], ['html', {open: 'never'}]],
    use: {
        baseURL: process.env.LAMPA_TEST_URL || 'http://127.0.0.1:18090',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        serviceWorkers: 'block'
    },
    projects: [
        {name: 'chromium', use: {browserName: 'chromium'}},
        {name: 'webkit', use: {browserName: 'webkit'}}
    ]
})
