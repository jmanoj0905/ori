// Module boundaries (spec 00 "Module boundaries" table; final review item 6),
// checked on the import graph of every non-test .ts / .tsx file. The engine's
// own rule (only rabbit.ts imports rabbit-ear) lives in engine/boundary.test.ts.
//
//   render/       the Three.js scene: engine types, three, the paper leaf; no
//                 studio, settings, persistence, input, React or zustand
//   settings/     bindings and prefs: nothing domain-specific (no studio,
//                 render, persistence, input or engine)
//   persistence/  autosave and exporters: engine, the paper leaf; no render,
//                 studio, settings, input or React (zustand/vanilla is fine)
//   paper.ts      a dependency-free leaf (paper look types and validation)
import { globSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

/** Every module specifier a file imports: static, side-effect, re-export and dynamic. */
function specifiers(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/(?:^|[\s;}])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]!)
  for (const m of src.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]!)
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!)
  return out
}

/** A specifier as the top-level area it reaches: 'studio', 'paper.ts', 'engine' (@engine), or the package name. */
function area(file: string, spec: string): string {
  if (spec === '@engine' || spec.startsWith('@engine/')) return 'engine'
  if (!spec.startsWith('.')) return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!
  const target = normalize(join(dirname(file), spec))
  const rel = relative('src', target).split(/[\\/]/)
  if (rel[0] === '..') return `outside:${rel.join('/')}`
  return rel.length === 1 ? rel[0]!.replace(/\.(ts|tsx)$/, '') + '.ts' : rel[0]!
}

function areasOf(folder: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const files = globSync(`src/${folder}/**/*.{ts,tsx}`).filter(f => !/\.test\.tsx?$/.test(f))
  for (const f of files) {
    for (const s of specifiers(f)) {
      const a = area(f, s)
      if (a === folder) continue
      out.set(a, [...(out.get(a) ?? []), f])
    }
  }
  return out
}

const offenders = (folder: string, banned: readonly string[]) =>
  [...areasOf(folder)].filter(([a]) => banned.includes(a)).map(([a, files]) => `${a} ← ${[...new Set(files)].join(', ')}`)

describe('module boundaries', () => {
  test('the checker sees static, dynamic and side-effect imports', () => {
    expect(area('src/render/Stage.ts', '../studio/store')).toBe('studio')
    expect(area('src/render/Stage.ts', '../paper')).toBe('paper.ts')
    expect(area('src/render/Stage.ts', '@engine')).toBe('engine')
    expect(area('src/render/Stage.ts', 'zustand/vanilla')).toBe('zustand')
    expect(areasOf('studio').has('engine')).toBe(true)
  })

  test('render imports no studio, settings, persistence, input, React or zustand', () => {
    expect(offenders('render', ['studio', 'settings', 'persistence', 'input', 'presets', 'react', 'react-dom', 'zustand'])).toEqual([])
  })

  test('settings imports nothing domain-specific', () => {
    expect(offenders('settings', ['studio', 'render', 'persistence', 'input', 'presets', 'engine', 'rabbit-ear'])).toEqual([])
  })

  test('persistence imports no render, studio, settings, input or React', () => {
    const bad = offenders('persistence', ['render', 'studio', 'settings', 'input', 'presets', 'react', 'react-dom'])
    // zustand's main entry is the React binding; the vanilla store is plain JS.
    const zustand = globSync('src/persistence/**/*.ts')
      .filter(f => !f.endsWith('.test.ts'))
      .filter(f => specifiers(f).some(s => s === 'zustand' || s === 'zustand/react'))
    expect([...bad, ...zustand]).toEqual([])
  })

  test('paper.ts is a leaf', () => {
    expect(specifiers('src/paper.ts')).toEqual([])
  })
})
