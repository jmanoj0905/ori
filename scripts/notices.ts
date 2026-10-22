// Third-party notices (final review item 7). Builds THIRD_PARTY_NOTICES.txt
// from the runtime dependency closure: package.json `dependencies`, then each
// package's own `dependencies`, read from node_modules (dev tools are never
// shipped, so never listed). Each entry: name, version, licence id, homepage
// and the package's full licence file. vite.config.ts emits it (and Ori's own
// LICENSE as LICENSE.txt) into the build, and serves both in dev.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type Pkg = { name: string; version: string; license: string; homepage?: string; text: string }

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

function licenceText(dir: string): string {
  const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : '(no licence file in the package)'
}

/** The runtime packages, sorted by name. */
export function runtimePackages(root: string): Pkg[] {
  const seen = new Map<string, Pkg>()
  const visit = (name: string) => {
    if (seen.has(name)) return
    const dir = join(root, 'node_modules', name)
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`notices: ${name} is not installed`)
    const pj = readJson(join(dir, 'package.json'))
    const license = typeof pj.license === 'string' ? pj.license : 'UNKNOWN'
    const homepage = typeof pj.homepage === 'string' ? pj.homepage : undefined
    seen.set(name, { name, version: String(pj.version), license, homepage, text: licenceText(dir) })
    for (const dep of Object.keys((pj.dependencies as Record<string, string>) ?? {})) visit(dep)
  }
  for (const dep of Object.keys((readJson(join(root, 'package.json')).dependencies as Record<string, string>) ?? {})) visit(dep)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The notices file's text. */
export function thirdPartyNotices(root: string): string {
  const pkgs = runtimePackages(root)
  const rule = '='.repeat(72)
  const head = [
    'Ori · 折り — third-party notices',
    '',
    'Ori is free software under the GNU General Public License v3 (see LICENSE.txt).',
    'It includes the following third-party software and fonts, each under its own licence:',
    '',
    ...pkgs.map(p => `  - ${p.name} ${p.version} — ${p.license}`),
    '',
  ]
  const bodies = pkgs.flatMap(p => [rule, `${p.name} ${p.version} — ${p.license}`, ...(p.homepage ? [p.homepage] : []), rule, '', p.text, ''])
  return [...head, ...bodies].join('\n')
}
