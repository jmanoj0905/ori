// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, commit, createPaper, patternFrame, type Frame } from '@engine'
import { addCrease, emptyCP } from '../designer/cp'
import { bezier } from './curvedCrease'
import { SoftSession, findCurves, type SoftStage } from './session'

function fakeStage() {
  const host = document.createElement('div')
  const canvas = document.createElement('canvas')
  host.appendChild(canvas)
  document.body.appendChild(host)
  let shown: Float32Array | null = null
  const stage: SoftStage & { shown(): Float32Array | null; hidden: boolean } = {
    canvas,
    hidden: false,
    shown: () => shown,
    showSoft: (_t, _uv, p) => { shown = Float32Array.from(p) },
    updateSoft: p => { shown = Float32Array.from(p as Float32Array) },
    hideSoft: () => { stage.hidden = true },
    pickSoft: () => ({ index: 0, point: [0, 0, 0] }),
    rayAt: () => [0, 0, 0.3],
  }
  return { stage, host, canvas }
}

/** Hand-driven animation frames. */
function frames() {
  let cb: ((t: number) => void) | null = null
  return {
    raf: (f: (t: number) => void) => ((cb = f), 1),
    caf: () => { cb = null },
    run: (t: number) => cb?.(t),
  }
}

const curved = (): Frame => {
  const curve = bezier([0, 0.25], [0.5, 0.75], [1, 0.25])
  let cp = emptyCP({ width: 1, height: 1 })
  for (let i = 0; i + 1 < curve.length; i++) cp = addCrease(cp, curve[i]!, curve[i + 1]!, 'V')
  const r = patternFrame(cp)
  if (!r.ok) throw new Error(r.reason)
  return r.frame
}

afterEach(() => { document.body.innerHTML = '' })

describe('the soft session', () => {
  test('finds curved creases (chains of short creases), not straight folds', () => {
    expect(findCurves(curved())).toHaveLength(1)
    const half = commit(createPaper(PAPER_SIZES.square), { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false })
    expect(half.ok && findCurves(half.frame)).toEqual([])
  })

  test('runs the solver on animation frames, a long pause is one ordinary step, and stop hands back the shape', async () => {
    const { stage } = fakeStage()
    const f = frames()
    const states: unknown[] = []
    const s = await SoftSession.start(stage, createPaper(PAPER_SIZES.square), { gpu: null, raf: f.raf, caf: f.caf, onState: x => states.push(x) })
    expect(states.at(-1)).toMatchObject({ solver: 'cpu', curves: 0 })
    f.run(0)
    f.run(16)
    f.run(60_000) // the tab was in the background for a minute
    const p = stage.shown()!
    expect(p.every(Number.isFinite)).toBe(true)
    expect(Math.max(...Array.from(p).map(Math.abs))).toBeLessThan(2) // nothing flew off
    const out = s.stop()
    expect(stage.hidden).toBe(true)
    expect(out.positions.length).toBe(out.mesh.uv.length * 1.5)
  })

  test('a primary-button drag grabs the soft sheet (the fold gesture never sees it); wet dries on release', async () => {
    const { stage, host, canvas } = fakeStage()
    const f = frames()
    const s = await SoftSession.start(stage, createPaper(PAPER_SIZES.square), { gpu: null, raf: f.raf, caf: f.caf })
    const fold = vi.fn()
    canvas.addEventListener('pointerdown', fold)
    const pin = vi.spyOn(s.sim, 'pin')
    const unpin = vi.spyOn(s.sim, 'unpin')
    const dry = vi.spyOn(s.sim, 'dry')
    s.setWet(true)
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 7, bubbles: true, clientX: 10, clientY: 10 }))
    expect(fold).not.toHaveBeenCalled()
    expect(pin).toHaveBeenLastCalledWith(0, [0, 0, 0])
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 20, clientY: 5 }))
    expect(pin).toHaveBeenLastCalledWith(0, [0, 0, 0.3])
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    expect(unpin).toHaveBeenCalledWith(0)
    expect(dry).toHaveBeenCalledTimes(1)
    // other buttons (orbit / pan) pass through to the Stage
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, pointerId: 8, bubbles: true }))
    expect(fold).toHaveBeenCalledTimes(1)
    void host
    s.stop()
  })

  test('Curve fold folds a curved crease exactly and holds it', async () => {
    const { stage } = fakeStage()
    const f = frames()
    const s = await SoftSession.start(stage, curved(), { gpu: null, raf: f.raf, caf: f.caf })
    expect(s.curveCount).toBe(1)
    expect(s.setCurve(30)).toBe(true)
    const p = stage.shown()!
    expect(Math.max(...Array.from(p).filter((_, i) => i % 3 === 2).map(Math.abs))).toBeGreaterThan(0.2)
    s.stop()
  })
})

describe('the governor and grabs', () => {
  test('a slow machine coarsens the mesh only between grabs, and grab targets stay above the desk', async () => {
    const { stage, canvas } = fakeStage()
    stage.rayAt = () => [0.5, 0.5, -0.3] // a pointer ray that would go into the desk
    const f = frames()
    const s = await SoftSession.start(stage, createPaper(PAPER_SIZES.square), { gpu: null, raf: f.raf, caf: f.caf })
    const before = s.mesh
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }))
    const pin = vi.spyOn(s.sim, 'pin')
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1 }))
    expect(pin).toHaveBeenLastCalledWith(0, [0.5, 0.5, 0])
    // 30 slow frames (40 ms each): iterations drop to the minimum, then a coarser mesh is due
    let t = 0
    for (let k = 0; k < 30; k++) f.run((t += 40))
    expect(s.mesh).toBe(before) // not while the sheet is held
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    f.run((t += 40))
    await new Promise(r => setTimeout(r, 0))
    expect(s.mesh).not.toBe(before)
    expect(s.mesh.uv.length).toBeLessThan(before.uv.length)
    s.stop()
  })
})
