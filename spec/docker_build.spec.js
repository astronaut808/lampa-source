import {describe, expect, it} from 'vitest'
import fs from 'node:fs'

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

describe('native frontend Docker build', ()=>{
    it('runs npm and frontend tests on the build platform, independently of the target architecture', ()=>{
        expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:22-alpine AS builder$/m)
        expect(dockerfile).toContain('RUN npm test -- --run && npm run build')
    })

    it('keeps the final runtime and metrics images on their selected target platforms', ()=>{
        expect(dockerfile).toMatch(/^FROM node:22-alpine AS metrics$/m)
        expect(dockerfile).toMatch(/^FROM nginxinc\/nginx-unprivileged:1\.28-alpine AS runtime$/m)
        expect(dockerfile.match(/^FROM --platform=/gm)).toHaveLength(1)
    })

    it('copies only architecture-independent web output from the native builder', ()=>{
        const copies = dockerfile.split('\n').filter(line=>line.startsWith('COPY --from=builder '))
        expect(copies).toEqual(['COPY --from=builder /app/build/web/ /usr/share/nginx/html/'])
    })
})
