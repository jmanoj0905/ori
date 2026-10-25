import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, createPaper, poses, type Frame } from '@engine'
import { remesh, type SoftMesh } from './remesh'
import { MAX_LAYERS, collide } from './collision'
import { SoftSolver } from './xpbd'

/**
 * Several flat sheets as one mesh: sheet k scaled by `scale`, shifted, lifted
 * to z = `lift`; each its own face, and its own part of the paper (uv moved
 * 2k to the right), as distinct layers of one sheet would be.
 */
function stack(sheets: { scale: number; lift: number; shift?: [number, number] }[], h = 0.1): SoftMesh {
  const f: Frame = createPaper(PAPER_SIZES.square)
  const base = remesh(f, poses(f), h)
  const n = base.uv.length / 2
  const positions: number[] = []
  const uv: number[] = []
  const tris: number[] = []
  const triFace: number[] = []
  const bendHinges: SoftMesh['bendHinges'] = []
  sheets.forEach(({ scale, lift, shift = [0, 0] }, k) => {
    for (let i = 0; i < n; i++) {
      positions.push(base.uv[2 * i]! * scale + shift[0], base.uv[2 * i + 1]! * scale + shift[1], lift)
      uv.push(base.uv[2 * i]! * scale + 2 * k, base.uv[2 * i + 1]! * scale)
    }
    for (const t of base.tris) tris.push(t + k * n)
    for (let t = 0; t < base.triFace.length; t++) triFace.push(k)
    for (const hg of base.bendHinges) bendHinges.push({ ...hg, a: hg.a + k * n, b: hg.b + k * n, c: hg.c + k * n, d: hg.d + k * n })
  })
  return {
    positions: Float32Array.from(positions), uv: Float32Array.from(uv), tris: Uint32Array.from(tris),
    creaseHinges: [], bendHinges, boundary: new Uint32Array(), edgeSamples: [], triFace: Uint32Array.from(triFace),
  }
}

describe('self-collision', () => {
  test('a falling flap does not pass through a single sheet', () => {
    const m = stack([{ scale: 1, lift: 0 }, { scale: 0.4, lift: 0.06, shift: [0.3, 0.3] }])
    const n = m.uv.length / 4
    const run = (collideOn: boolean) => {
      const s = new SoftSolver(m, { bendCompliance: 1e-3, creaseCompliance: 1e-4, iterations: 6, wet: false, gravity: [0, 0, -9.81], collide: collideOn })
      for (let i = 0; i < n; i++) s.pin(i, [m.positions[3 * i]!, m.positions[3 * i + 1]!, 0]) // the sheet is held
      for (let k = 0; k < 90; k++) s.step(1 / 60)
      const p = s.positions()
      let low = Infinity
      for (let i = n; i < 2 * n; i++) low = Math.min(low, p[3 * i + 2]!)
      return low
    }
    expect(run(false)).toBeLessThan(-0.1) // without collision the flap falls through
    expect(run(true)).toBeGreaterThan(-1e-3) // with it, it lands on the sheet
  })

  test(`stacks of more than ${MAX_LAYERS} layers are skipped and reported (they render rigid)`, () => {
    const layers = 12
    const m = stack(Array.from({ length: layers }, (_, k) => ({ scale: 1, lift: k * 0.0005 })), 0.25)
    const x = Float64Array.from(m.positions)
    const before = x.slice()
    const r = collide(x, x.slice(), m, () => 1, { thickness: 0.004 })
    expect(r.skippedCells).toBeGreaterThan(0)
    expect(Array.from(x)).toEqual(Array.from(before)) // nothing pushed apart inside the dense stack
    const thin = stack([{ scale: 1, lift: 0 }, { scale: 1, lift: 0.001 }], 0.25)
    const y = Float64Array.from(thin.positions)
    const r2 = collide(y, y.slice(), thin, () => 1, { thickness: 0.004 })
    expect(r2.skippedCells).toBe(0)
    expect(r2.contacts).toBeGreaterThan(0)
  })
})
