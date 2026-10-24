// Bundle-size gate (spec 00 quality bar: "First load under 300 KB of gzipped
// JS"; Ruling R31, metric per Ruling R50).
//
// Counted: all the JavaScript needed for the first interactive paint —
//   - the entry script in dist/index.html, every chunk it modulepreloads, and
//     (transitively) every chunk those import statically;
//   - the chunks the app imports dynamically AT MOUNT (MOUNT_TIME: the Stage,
//     i.e. three.js, loaded by App's first effect to draw the canvas), with
//     their static imports.
// Reported but not counted: chunks loaded on demand later (the settings and
// shortcut sheets, the preset player) and the engine Worker (spawned on the
// first commit).
//
// Also asserts that the build ships LICENSE.txt and THIRD_PARTY_NOTICES.txt,
// and that the shipped build carries no e2e test hook (window.__ori,
// exposed only by `vite build --mode e2e`).
//
// Runs after every `npm run build` (postbuild), so a build over budget fails;
// `npm run size` re-runs it alone (DIST=dist-e2e to inspect another build).
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
/** Source modules the app imports dynamically on mount (their chunks are named after them). */
const MOUNT_TIME = ['Stage']

const eager = new Set()
const visit = file => {
  if (eager.has(file)) return
  eager.add(file)
  const src = readFileSync(join(dist, file), 'utf8')
  for (const m of src.matchAll(STATIC)) visit(join('assets', m[1].slice(2)))
}
refs.forEach(visit)

const all = readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js')).map(f => join('assets', f))
for (const name of MOUNT_TIME) {
  const chunk = all.find(f => new RegExp(`^assets/${name}-[\\w-]+\\.js$`).test(f))
  if (!chunk) {
    console.error(`FAIL: no ${name}-*.js chunk (the mount-time import moved or was renamed): update MOUNT_TIME`)
    process.exit(1)
  }
  visit(chunk)
}
let total = 0
console.log(`Initial-load JS (${dist}): eager + mount-time ${MOUNT_TIME.join(', ')}`)
for (const f of eager) {
  const n = gz(f)
  total += n
  console.log(`  ${f.padEnd(40)} ${kb(n).padStart(7)} KB gz`)
}
console.log('On-demand / worker JS (not counted):')
for (const f of all.filter(f => !eager.has(f))) console.log(`  ${f.padEnd(40)} ${kb(gz(f)).padStart(7)} KB gz`)
console.log(`First load: ${kb(total)} KB gzip of JS (limit ${LIMIT_KB} KB)`)

let failed = total >= LIMIT_KB * 1024
if (failed) console.error(`FAIL: first-load JS ${kb(total)} KB ≥ ${LIMIT_KB} KB gzip`)

// The licences ship with the site (vite.config.ts, licences()).
for (const f of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) {
  if (!existsSync(join(dist, f)) || readFileSync(join(dist, f), 'utf8').length < 200) {
    console.error(`FAIL: ${f} missing from the build`)
    failed = true
  } else console.log(`Ships ${f}.`)
}

// Spec 00: "Lessons and the designer are code-split": their data and UI stay out of the first load.
// Each marker is a string only that feature's on-demand chunks contain.
const SPLIT = {
  lessons: ['Waterbomb base', 'Lesson summary', 'canonical: the sheet outline is not a rectangle'],
  designer: ['Crease pattern editor', 'Fold two points onto two creases at once'],
}
for (const [feature, markers] of Object.entries(SPLIT)) {
  const leaked = [...eager].filter(f => markers.some(m => readFileSync(join(dist, f), 'utf8').includes(m)))
  if (leaked.length) {
    console.error(`FAIL: ${feature} code is in the first load: ${leaked.join(', ')}`)
    failed = true
  } else if (!markers.every(m => all.some(f => readFileSync(join(dist, f), 'utf8').includes(m)))) {
    console.error(`FAIL: no ${feature} chunk found (markers ${markers.join(', ')}): update SPLIT`)
    failed = true
  } else console.log(`The ${feature} ${feature.endsWith('s') ? 'are' : 'is'} code-split.`)
}

if (dist === 'dist') {
  const hooked = all.filter(f => readFileSync(join(dist, f), 'utf8').includes('__ori'))
  if (hooked.length) {
    console.error(`FAIL: the e2e test hook (__ori) is in the production build: ${hooked.join(', ')}`)
    failed = true
  } else console.log('No test hook in the production build.')
}
process.exit(failed ? 1 : 0)
