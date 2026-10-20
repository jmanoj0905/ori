import { globSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

test('only rabbit.ts imports rabbit-ear', () => {
  const offenders = globSync('src/**/*.{ts,tsx}')
    .filter(f => !f.endsWith('src/engine/rabbit.ts') && !f.endsWith('.test.ts'))
    .filter(f => /from ['"]rabbit-ear/.test(readFileSync(f, 'utf8')))
  expect(offenders).toEqual([])
})

test('rabbit-ear is pinned exactly', () => {
  expect(pkg.dependencies['rabbit-ear']).toBe('0.9.41')
})

test('license is GPL-3.0-only', () => {
  expect(pkg.license).toBe('GPL-3.0-only')
})
