// Pre-ship checks (final review items 13–15): a real version for About, a
// page description and a favicon.
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('the package has a v1 version (About shows it)', () => {
  expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toMatch(/^1\.\d+\.\d+$/)
})

test('index.html has a description and an SVG favicon that ships', () => {
  const html = readFileSync('index.html', 'utf8')
  expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/)
  expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
  expect(existsSync('public/favicon.svg')).toBe(true)
})
