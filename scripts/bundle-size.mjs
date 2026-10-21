// Bundle-size gate (spec: main bundle < 300 KB gzip; Ruling R31).
//
// "Main bundle" = the JavaScript the browser must load before the app can
// start: the entry script in dist/index.html, every chunk it modulepreloads,
// and (transitively) every chunk those import statically. Lazy chunks
// (import(): the Stage / three.js, the settings and shortcut sheets, the preset
// player) and the engine Worker are reported but not counted.
//
// Also asserts that the shipped build carries no e2e test hook (window.__ori,
// exposed only by `vite build --mode e2e`).
//
// Usage: npm run build && npm run size   (DIST=dist-e2e to inspect another build)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const LIMIT_KB = 300
const dist = process.env.DIST ?? 'dist'
const html = join(dist, 'index.html')
if (!existsSync(html)) {
  console.error(`${html} not found: run \`npm run build\` first.`)
  process.exit(1)
}

const gz = file => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
const kb = n => (n / 1024).toFixed(1)
const page = readFileSync(html, 'utf8')
const refs = [...page.matchAll(/<script[^>]*type="module"[^>]*src="\/([^"]+)"|<link[^>]*rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(
  m => m[1] ?? m[2],
)

// Static imports inside a chunk: `import ... from "./x.js"` / `import "./x.js"` / `export ... from "./x.js"`.
const STATIC = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]+from\s*)?["'](\.\/[^"']+\.js)["']/g
const eager = new Set()
const visit = file => {
  if (eager.has(file)) return
  eager.add(file)
  const src = readFileSync(join(dist, file), 'utf8')
  for (const m of src.matchAll(STATIC)) visit(join('assets', m[1].slice(2)))
}
refs.forEach(visit)

const all = readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js')).map(f => join('assets', f))
let total = 0
console.log(`Eager JS (${dist}):`)
for (const f of eager) {
  const n = gz(f)
  total += n
  console.log(`  ${f.padEnd(40)} ${kb(n).padStart(7)} KB gz`)
}
console.log('Lazy / worker JS (not counted):')
for (const f of all.filter(f => !eager.has(f))) console.log(`  ${f.padEnd(40)} ${kb(gz(f)).padStart(7)} KB gz`)
console.log(`Main bundle: ${kb(total)} KB gzip (limit ${LIMIT_KB} KB)`)

let failed = total >= LIMIT_KB * 1024
if (failed) console.error(`FAIL: main bundle ${kb(total)} KB ≥ ${LIMIT_KB} KB gzip`)

if (dist === 'dist') {
  const hooked = all.filter(f => readFileSync(join(dist, f), 'utf8').includes('__ori'))
  if (hooked.length) {
    console.error(`FAIL: the e2e test hook (__ori) is in the production build: ${hooked.join(', ')}`)
    failed = true
  } else console.log('No test hook in the production build.')
}
process.exit(failed ? 1 : 0)
