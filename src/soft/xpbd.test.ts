import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, poses, type Frame } from '@engine'
import { remesh, type SoftMesh } from './remesh'
import { MAX_DT, SoftSolver, buildConstraints, type SoftParams } from './xpbd'

const sheet = (): Frame => createPaper(PAPER_SIZES.square)
const meshOf = (f: Frame, h = 0.125): SoftMesh => remesh(f, poses(f), h)
const params = (over: Partial<SoftParams> = {}): SoftParams => ({ bendCompliance: 1e-3, creaseCompliance: 1e-4, iterations: 4, wet: false, ...over })

/** Particles with uv on the given paper-space predicate. */
const where = (m: SoftMesh, pred: (x: number, y: number) => boolean) =>
  Array.from({ length: m.uv.length / 2 }, (_, i) => i).filter(i => pred(m.uv[2 * i]!, m.uv[2 * i + 1]!))
const z = (s: SoftSolver) => Array.from(s.positions()).filter((_, i) => i % 3 === 2)

describe('the CPU XPBD solver', () => {
  test('10,000 steps of a hanging sheet: no explosion, |v| stays bounded', () => {
    const m = meshOf(sheet(), 0.2)
    const s = new SoftSolver(m, params({ gravity: [0, -9.81, 0], iterations: 10 }))
    for (const i of where(m, (x, y) => y > 0.999 && (x < 1e-3 || x > 0.999))) s.pin(i, [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!])
    let worst = 0
    for (let k = 0; k < 10_000; k++) {
      s.step(1 / 60)
      if (k % 50 === 0) worst = Math.max(worst, s.maxSpeed())
    }
    expect(s.positions().every(Number.isFinite)).toBe(true)
    expect(worst).toBeLessThan(10) // free fall over the sheet's own height is ~4.4 per second
    expect(s.maxSpeed()).toBeLessThan(10)
    // still hanging from its corners, and still a sheet (edges keep their length)
    expect(s.maxStretch()).toBeLessThan(0.05)
  }, 60_000)

  test('step(5) behaves like step(1/30): a long pause (backgrounded tab) is clamped (Review Focus 1)', () => {
    const m = meshOf(sheet())
    const a = new SoftSolver(m, params({ gravity: [0, 0, -9.81] }))
    const b = new SoftSolver(m, params({ gravity: [0, 0, -9.81] }))
    a.pin(0, [0, 0, 0])
    b.pin(0, [0, 0, 0])
    a.step(5)
    b.step(1 / 30)
    expect(Array.from(a.positions())).toEqual(Array.from(b.positions()))
    expect(MAX_DT).toBeCloseTo(1 / 30, 12)
    // and the sheet did not jump: one 1/30 s step of free fall is small
    expect(Math.min(...z(a))).toBeGreaterThan(-0.05)
    a.step(0)
    a.step(Number.NaN)
    a.step(-1)
    expect(Array.from(a.positions())).toEqual(Array.from(b.positions()))
  })

  test('with crease constraints only, a flat model stays flat to within 1e-4', () => {
    const one = commit(sheet(), { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false, angleDeg: 0.000001 })
    const f = one.ok ? one.frame : sheet()
    const m = meshOf(f)
    expect(m.creaseHinges.length).toBeGreaterThan(0)
    const s = new SoftSolver(m, params({ bendCompliance: Infinity, gravity: [0, -9.81, 0] }))
    for (const i of where(m, (_, y) => y > 0.999)) s.pin(i, [m.positions[3 * i]!, m.positions[3 * i + 1]!, 0])
    for (let k = 0; k < 600; k++) s.step(1 / 60)
    expect(Math.max(...z(s).map(Math.abs))).toBeLessThan(1e-4)
  })

  test('wet mode lowers the bending stiffness: a pinned sheet sags more', () => {
    const m = meshOf(sheet())
    const sag = (wet: boolean) => {
      const s = new SoftSolver(m, params({ wet, bendCompliance: 1e-2, gravity: [0, 0, -9.81] }))
      // clamped along a strip (one pinned row would just swing like a door)
      for (const i of where(m, x => x < 0.13)) s.pin(i, [m.positions[3 * i]!, m.positions[3 * i + 1]!, 0])
      for (let k = 0; k < 240; k++) s.step(1 / 60)
      return -Math.min(...z(s))
    }
    const dry = sag(false)
    const wet = sag(true)
    expect(dry).toBeGreaterThan(0.01)
    expect(wet).toBeGreaterThan(dry * 1.5)
  })

  test('pin and unpin: a pinned particle follows its target, an unpinned one falls', () => {
    const m = meshOf(sheet())
    const s = new SoftSolver(m, params({ gravity: [0, 0, -9.81] }))
    s.pin(0, [0, 0, 0.3])
    for (let k = 0; k < 30; k++) s.step(1 / 60)
    expect(Array.from(s.positions().slice(0, 3))).toEqual([0, 0, Math.fround(0.3)])
    s.unpin(0)
    for (let k = 0; k < 30; k++) s.step(1 / 60)
    expect(s.positions()[2]).toBeLessThan(0.3)
  })

  test('constraints are graph-coloured: no two in a colour share a particle', () => {
    const c = buildConstraints(meshOf(sheet(), 0.1))
    for (const colors of [c.distanceColors, c.hingeColors])
      for (let k = 0; k + 1 < colors.length; k++) {
        const seen = new Set<number>()
        for (let i = colors[k]!; i < colors[k + 1]!; i++) {
          const ps = colors === c.distanceColors ? [c.dist[2 * i]!, c.dist[2 * i + 1]!] : [0, 1, 2, 3].map(j => c.hinge[4 * i + j]!)
          for (const p of ps) {
            expect(seen.has(p)).toBe(false)
            seen.add(p)
          }
        }
      }
  })

  test('drying: the current shape becomes the rest shape, so the sculpt holds when the paper stiffens', () => {
    const m = meshOf(sheet())
    const moved = (dried: boolean) => {
      // 8 substeps: with fewer, XPBD's iteration-limited stiffness, not the compliance, decides the shape
      const s = new SoftSolver(m, params({ wet: true, bendCompliance: 1e-2, iterations: 8, gravity: [0, 0, -2] }))
      for (const i of where(m, x => x < 0.13)) s.pin(i, [m.positions[3 * i]!, m.positions[3 * i + 1]!, 0])
      for (let k = 0; k < 240; k++) s.step(1 / 60)
      if (dried) s.dry()
      s.setParams({ wet: false })
      const before = s.positions().slice()
      for (let k = 0; k < 120; k++) s.step(1 / 60)
      const after = s.positions()
      let worst = 0
      for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(before[i]! - after[i]!))
      return worst
    }
    const dried = moved(true)
    const undried = moved(false)
    expect(undried).toBeGreaterThan(0.05) // stiffened without drying, the sheet springs back up
    expect(dried).toBeLessThan(0.05) // dried, it holds its sagged form
    expect(dried).toBeLessThan(undried / 4)
  })
})

describe('the desk', () => {
  test('a sheet dropped onto the desk rests on it', () => {
    const m = meshOf(sheet())
    const lifted = { ...m, positions: Float32Array.from(m.positions, (v, i) => (i % 3 === 2 ? v + 0.2 : v)) }
    const s = new SoftSolver(lifted, params({ gravity: [0, 0, -9.81], floor: 0 }))
    for (let k = 0; k < 120; k++) s.step(1 / 60)
    expect(Math.min(...z(s))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...z(s))).toBeLessThan(1e-3)
  })
})

describe('the desk holds the paper', () => {
  test('a sheet resting on the desk stays flat (friction does not fight the paper)', () => {
    const m = meshOf(sheet(), 1 / 32)
    const s = new SoftSolver(m, params({ gravity: [0, 0, -2], floor: 0, iterations: 8 }))
    for (let k = 0; k < 60; k++) s.step(1 / 60)
    expect(Math.max(...z(s))).toBeLessThan(1e-4)
  })

  test('pulling one corner up and across curls the sheet; the far corner moves less than half as far', () => {
    const m = meshOf(sheet())
    const s = new SoftSolver(m, params({ gravity: [0, 0, -2], floor: 0 }))
    const corner = where(m, (x, y) => x > 0.999 && y > 0.999)[0]!
    const far = where(m, (x, y) => x < 1e-3 && y < 1e-3)[0]!
    for (let k = 1; k <= 60; k++) {
      s.pin(corner, [1 - 0.4 * (k / 60), 1, 0.4 * (k / 60)])
      s.step(1 / 60)
    }
    const p = s.positions()
    expect(Math.hypot(p[3 * far]!, p[3 * far + 1]!)).toBeLessThan(0.5 * 0.4 * Math.SQRT2) // the desk holds the rest of the sheet back
    expect(Math.max(...z(s))).toBeGreaterThan(0.3)
  })
})
