import fs from 'node:fs'
import vm from 'node:vm'

// Run complete production modules with mocked browser I/O, not copied functions.
export function loadBrowserModule(file, globals){
    const source = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
        .replace(/^import .* from .*$/gm, '')
        .replace('export default', 'globalThis.moduleResult =')
        .replace(/export\s*\{([^}]*)\}\s*$/, 'globalThis.moduleResult = {$1}')
    const context = {...globals}
    vm.runInNewContext('"use strict";\n' + source, context, {filename: file})
    return context.moduleResult
}
