import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)) },
  },
  // Unit tests only: the Playwright specs in e2e/ run through `npm run e2e`.
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-e2e/**'],
  },
})
