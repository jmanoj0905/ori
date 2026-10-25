import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { thirdPartyNotices } from './scripts/notices'

/**
 * Ships the licences (spec 00: "LICENSE and source link are shown in the UI";
 * final review item 7): /LICENSE.txt (Ori's GPLv3) and /THIRD_PARTY_NOTICES.txt
 * (every runtime dependency's licence, scripts/notices.ts), emitted into the
 * build and served by the dev server. Settings → About links both.
 */
function licences(): Plugin {
  const files = () => ({
    'LICENSE.txt': readFileSync('LICENSE', 'utf8'),
    'THIRD_PARTY_NOTICES.txt': thirdPartyNotices('.'),
  })
  return {
    name: 'ori-licences',
    generateBundle() {
      for (const [fileName, source] of Object.entries(files())) this.emitFile({ type: 'asset', fileName, source })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.replace(/^\//, '').split('?')[0] ?? ''
        const all: Record<string, string> = files()
        if (!(name in all)) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(all[name])
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), licences()],
  resolve: {
    alias: { '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)) },
  },
  // Unit tests only: the Playwright specs in e2e/ run through `npm run e2e`.
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-e2e/**'],
  },
})
