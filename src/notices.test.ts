// Third-party notices (final review item 7): the build ships every runtime
// dependency's licence text as /THIRD_PARTY_NOTICES.txt, and Ori's own GPL
// text as /LICENSE.txt; Settings → About links both.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { runtimePackages, thirdPartyNotices } from '../scripts/notices'

test('every runtime dependency (and what it pulls in) is listed, dev tools are not', () => {
  const names = runtimePackages('.').map(p => p.name)
  for (const n of ['react', 'react-dom', 'scheduler', 'three', 'zustand', 'rabbit-ear', '@fontsource/ibm-plex-sans', '@fontsource/ibm-plex-mono', '@fontsource/instrument-serif']) {
    expect(names).toContain(n)
  }
  expect(names).not.toContain('vite')
  expect(names).not.toContain('vitest')
})

test('the notices carry each licence id and its full text', () => {
  const text = thirdPartyNotices('.')
  expect(text).toMatch(/three 0\.186\.\d+ — MIT/)
  expect(text).toMatch(/@fontsource\/instrument-serif [\d.]+ — OFL-1\.1/)
  expect(text).toContain(readFileSync('node_modules/three/LICENSE', 'utf8').trim())
  expect(text).toContain('SIL OPEN FONT LICENSE')
})
