// Interop with Rabbit Ear (spec 05: "a .fold export loads in Rabbit Ear and
// gives the same frame"). Test files may import rabbit-ear directly; app code
// reaches it only through ./rabbit.ts. For each preset history (and a plane
// that was turned over) the exported .fold must parse as a FOLD object, every
// frame must flatten and validate, Rabbit Ear's folded form must equal the
// engine's, and its layer solver must agree with the exported faceOrders.
// Non-flat 90 degree valley and mountain folds must match the engine's 3D poses.
import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, frameFromFold, jumpTo, poses, push, startHistory, turnOver } from '@engine'
import type { History } from '@engine'
import { populate } from 'rabbit-ear/graph/populate.js'
import { makeVerticesCoordsFolded } from 'rabbit-ear/graph/vertices/folded.js'
import { validate } from 'rabbit-ear/graph/validate/validate.js'
import { layer } from 'rabbit-ear/layer/layer.js'
import { countFrames, flattenFrame } from 'rabbit-ear/fold/frames.js'
import { isFoldObject } from 'rabbit-ear/fold/spec.js'
import { foldedCoords } from './rabbit'
import { applyPose } from './poses'
import { toFoldFile } from '../persistence/foldExport'
import { gesture } from '../presets/gestures'
import { PRESETS, runPreset } from '../presets'

const histories: [string, History][] = []
for (const p of PRESETS) {
  const r = runPreset(p)
  if (!r.ok) throw new Error(r.reason)
  histories.push([p.id, r.history])
}
{
  const plane = histories.find(([id]) => id === 'plane')![1]
  const h0 = jumpTo(plane, 2)
  const t = turnOver(current(h0))
  histories.push(['plane turned over after step 2', push(h0, t.step, t.frame)])
}

describe('.fold export in Rabbit Ear', () => {
  test('the presets include plane, cup and crane', () => {
    expect(histories.map(([id]) => id)).toEqual(expect.arrayContaining(['plane', 'cup', 'crane']))
  })

  test.each(histories)('%s: loads, validates, folds and layers the same', (_name, h) => {
    const fold = JSON.parse(toFoldFile(h))
    expect(isFoldObject(fold)).toBeGreaterThan(0) // Rabbit Ear returns a score, 0 = not FOLD
    expect(countFrames(fold)).toBeGreaterThan(1)
    let checkedOrders = 0
    for (let i = 0; i < countFrames(fold); i++) {
      const fr = flattenFrame(fold, i)
      // frame 0 is the top-level (current) frame; frame k is file_frames[k - 1] = history frame k - 1
      const eng = i === 0 ? current(h) : h.frames[i - 1]!
      const g = populate(structuredClone(fr))
      expect(validate(g)).toEqual([])
      const folded = makeVerticesCoordsFolded(g, [0])
      const mine = foldedCoords(eng)
      expect(folded).toHaveLength(mine.length)
      let err = 0
      folded.forEach((p: number[], k: number) => {
        err = Math.max(err, Math.hypot(p[0]! - mine[k]![0], p[1]! - mine[k]![1]), Math.abs(p[2] ?? 0))
      })
      expect(err).toBeLessThan(1e-9)
      expect(frameFromFold(fr).ok).toBe(true)
      if (i === 0 && fr.edges_foldAngle.every((a: number) => a === 0 || Math.abs(a) === 180)) {
        const sol = layer({ ...g, vertices_coords: folded.map((p: number[]) => [p[0], p[1]]) })
        const exported = new Map<string, number>(fr.faceOrders.map((o: number[]) => [`${o[0]},${o[1]}`, o[2]]))
        for (const o of sol.faceOrders() as number[][]) {
          const a = exported.get(`${o[0]},${o[1]}`)
          const b = exported.get(`${o[1]},${o[0]}`)
          if (a === undefined && b === undefined) continue
          checkedOrders++
          expect(a === undefined ? -b! : a).toBe(o[2])
        }
      }
    }
    expect(checkedOrders).toBeGreaterThan(0)
  })

  test.each(['valley', 'mountain'] as const)('a 90 degree %s fold: Rabbit Ear 3D folded form equals the engine poses', kind => {
    let h = startHistory(createPaper(PAPER_SIZES.square))
    const r = commit(current(h), { ...gesture('fold', [0.9, 0.5], [0.1, 0.5], 1, kind), angleDeg: 90 })
    if (!r.ok) throw new Error(r.reason)
    h = push(h, r.step, r.frame)
    const fold = JSON.parse(toFoldFile(h))
    expect(isFoldObject(fold)).toBeGreaterThan(0) // Rabbit Ear returns a score, 0 = not FOLD
    expect(fold.edges_foldAngle.some((a: number) => Math.abs(a) === 90)).toBe(true)
    const re = makeVerticesCoordsFolded(populate(structuredClone(fold)), [0])
    const fr = current(h)
    const ps = poses(fr)
    let err = 0
    let lifted = 0
    fr.faces_vertices.forEach((vs, f) =>
      vs.forEach(v => {
        const p = applyPose(ps[f]!.matrix, fr.vertices_coords[v]!)
        const q = re[v]!
        err = Math.max(err, Math.hypot(p[0] - q[0]!, p[1] - q[1]!, p[2] - (q[2] ?? 0)))
        if (Math.abs(p[2]) > 0.1) lifted++
      }),
    )
    expect(lifted).toBeGreaterThan(0) // genuinely 3D, not a flat pass
    expect(err).toBeLessThan(1e-9)
  })
})
