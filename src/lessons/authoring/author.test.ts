// The lesson authoring script, not a test: `npm run author:lessons` (which
// sets ORI_AUTHOR=1) replays each recording through the engine and writes
// src/lessons/data/<id>.json from its exported history (devExport), keeping
// the hand-written captions, hints, cameras and allowMirror flags of the
// file already there, step by step. In a normal test run it is skipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { commit, createPaper, current, push, startHistory, turnOver } from '@engine'
import { lessonSkeleton, type LessonJSON } from '../devExport'
import { sheetOf } from '../schema'
import { RECORDINGS } from './recordings'

type Kept = Pick<LessonJSON['steps'][number], 'caption' | 'hint' | 'allowMirror' | 'camera'>

/** One step per line group: the hand-edited fields readable, the target frame on one line. */
function format(l: LessonJSON): string {
  const { steps, ...meta } = l
  const head = JSON.stringify(meta, null, 2).replace(/\n}$/, '')
  const body = steps.map(({ target, demo, ...rest }) => {
    const fields = Object.entries(rest).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    if (demo) fields.push(`      "demo": ${JSON.stringify(demo)}`)
    fields.push(`      "target": ${JSON.stringify(target)}`)
    return `    {\n${fields.join(',\n')}\n    }`
  })
  return `${head},\n  "steps": [\n${body.join(',\n')}\n  ]\n}\n`
}

test.skipIf(!process.env.ORI_AUTHOR)('author the lesson data from the recordings', () => {
  for (const rec of RECORDINGS) {
    let h = startHistory(createPaper(sheetOf(rec.paper)))
    for (const [i, s] of rec.steps.entries()) {
      const r = s.tool === 'turnOver' ? turnOver(current(h)) : commit(current(h), s)
      if (!r.ok) throw new Error(`${rec.id} step ${i + 1}: ${r.reason}`)
      h = push(h, r.step, r.frame)
    }
    const { steps: _, ...meta } = rec
    const sk = lessonSkeleton(h, meta)
    const file = `src/lessons/data/${rec.id}.json`
    const old: { steps?: Kept[] } = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    sk.steps = sk.steps.map((s, i) => {
      const k = old.steps?.[i]
      const { caption, hint, tool, demo, target } = s
      return {
        caption: k?.caption ?? caption,
        hint: k?.hint ?? hint,
        tool,
        ...(k?.allowMirror !== undefined ? { allowMirror: k.allowMirror } : {}),
        ...(k?.camera !== undefined ? { camera: k.camera } : {}),
        ...(demo ? { demo } : {}),
        target,
      }
    })
    writeFileSync(file, format(sk))
  }
}, 120_000)
