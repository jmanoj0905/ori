import { globSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, layerAt, poses, type Frame, type Gesture, type History, type Vec2 } from '@engine'
import { PRESETS, runPreset, type Preset } from './index'

// ---- helpers (public API only: folded positions come from `poses`) ----

const close = (a: number, b: number, eps = 1e-7) => Math.abs(a - b) < eps
const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1])

/** Crease-pattern area: the sum of |shoelace| over faces. */
function area(f: Frame): number {
  return f.faces_vertices.reduce((sum, vs) => {
    let a = 0
    vs.forEach((v, i) => {
      const [x0, y0] = f.vertices_coords[v]
      const [x1, y1] = f.vertices_coords[vs[(i + 1) % vs.length]]
      a += x0 * y1 - x1 * y0
    })
    return sum + Math.abs(a) / 2
  }, 0)
}

/** Folded (world, z dropped) position of every vertex of every face, via the public `poses`. */
function foldedFaces(f: Frame): Vec2[][] {
  const ps = poses(f)
  return f.faces_vertices.map((vs, i) => {
    const m = ps[i].matrix
    return vs.map(v => {
      const [x, y] = f.vertices_coords[v]
      return [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]] as Vec2
    })
  })
}

/** Folded position of vertex v (through any face that holds it). */
function foldedVertex(f: Frame, v: number, ff = foldedFaces(f)): Vec2 {
  const i = f.faces_vertices.findIndex(vs => vs.includes(v))
  return ff[i][f.faces_vertices[i].indexOf(v)]
}

/**
 * The paper's corners: vertices whose two boundary edges are not collinear in
 * paper space (paper coordinates are a rigid image of the sheet, so corners
 * are found by shape, not position).
 */
function paperCorners(f: Frame): number[] {
  const ns = f.vertices_coords.map(() => [] as number[])
  f.edges_vertices.forEach(([u, v], e) => {
    if (f.edges_assignment[e] !== 'B') return
    ns[u].push(v)
    ns[v].push(u)
  })
  const P = f.vertices_coords
  return ns
    .map((n, v) => {
      if (n.length !== 2) return -1
      const [a, b] = n
      const cr = (P[a][0] - P[v][0]) * (P[b][1] - P[v][1]) - (P[a][1] - P[v][1]) * (P[b][0] - P[v][0])
      return Math.abs(cr) > 1e-9 ? v : -1
    })
    .filter(v => v >= 0)
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, collinear points dropped. */
function hull(points: Vec2[]): Vec2[] {
  const ps = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const build = (list: Vec2[]) => {
    const out: Vec2[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop()
      out.push(p)
    }
    return out
  }
  const lower = build(ps)
  const upper = build([...ps].reverse())
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

const isFlat = (f: Frame) => f.edges_foldAngle.every(a => close(a, 0, 1e-6) || close(Math.abs(a), 180, 1e-6))

function centroid(poly: Vec2[]): Vec2 {
  let a = 0
  let cx = 0
  let cy = 0
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]
    const c = p[0] * q[1] - q[0] * p[1]
    a += c
    cx += (p[0] + q[0]) * c
    cy += (p[1] + q[1]) * c
  })
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * A frame's layer order is usable: every faceOrders entry names two distinct
 * existing faces with a ±1 sign, a folded model has at least one order, and
 * at each face's folded centroid `layerAt` returns a strict stack (distinct
 * faces) that contains that face.
 */
function checkLayers(f: Frame, label: string) {
  const n = f.faces_vertices.length
  if (n > 1) expect(f.faceOrders.length, `${label}: faceOrders`).toBeGreaterThan(0)
  for (const [a, b, s] of f.faceOrders) {
    expect(a !== b && a >= 0 && b >= 0 && a < n && b < n, `${label}: order ${a},${b}`).toBe(true)
    expect(Math.abs(s), `${label}: order sign`).toBe(1)
  }
  const ff = foldedFaces(f)
  ff.forEach((poly, i) => {
    const stack = layerAt(f, centroid(poly))
    expect(stack, `${label}: face ${i} under its own centroid`).toContain(i)
    expect(new Set(stack).size, `${label}: stack at face ${i} is strict`).toBe(stack.length)
  })
}

function history(p: Preset): History {
  const r = runPreset(p)
  if (!r.ok) throw new Error(`${p.id}: ${r.reason}`)
  return r.history
}

const byId = (id: Preset['id']) => {
  const p = PRESETS.find(q => q.id === id)
  if (!p) throw new Error(`no preset ${id}`)
  return p
}

const toolCount = (p: Preset, tool: string) => p.steps.filter(s => s.tool === tool).length

// ---- every preset ----

describe('PRESETS', () => {
  test('are the plane (A4), the cup and the crane (square)', () => {
    expect(PRESETS.map(p => [p.id, p.paper])).toEqual([
      ['plane', 'a4'],
      ['cup', 'square'],
      ['crane', 'square'],
    ])
    for (const p of PRESETS) expect(p.name.length).toBeGreaterThan(0)
  })

  test('every step is a real flat gesture (or a turn over)', () => {
    for (const p of PRESETS)
      for (const s of p.steps) {
        if (s.tool === 'turnOver') {
          expect(Object.keys(s)).toEqual(['tool'])
          continue
        }
        expect(['fold', 'reverse', 'squash', 'petal']).toContain(s.tool)
        expect(['valley', 'mountain']).toContain(s.kind)
        expect(s.progress).toBe(1)
        expect(s.snapAngle).toBe(false)
        expect(Number.isInteger(s.layers) && s.layers >= 1).toBe(true)
        for (const v of [...s.grab, ...s.target]) expect(Number.isFinite(v)).toBe(true)
      }
  })

  for (const id of ['plane', 'cup', 'crane'] as const) {
    describe(id, () => {
      test('runs to the end', () => {
        const p = byId(id)
        const r = runPreset(p)
        expect(r.ok ? 'ok' : r.reason).toBe('ok')
        if (!r.ok) return
        expect(r.history.frames).toHaveLength(p.steps.length + 1)
        expect(r.history.steps.map(s => s.kind)).toEqual(p.steps.map(s => s.tool))
        expect(r.history.cursor).toBe(p.steps.length)
      })

      test('every frame is flat, keeps the paper area and has a valid layer order', () => {
        const p = byId(id)
        const { width, height } = PAPER_SIZES[p.paper]
        history(p).frames.forEach((f, i) => {
          expect(isFlat(f), `frame ${i} flat`).toBe(true)
          expect(area(f)).toBeCloseTo(width * height, 9)
          checkLayers(f, `${id} frame ${i}`)
        })
      })

      test('the final area equals the paper area', () => {
        const p = byId(id)
        const { width, height } = PAPER_SIZES[p.paper]
        const h = history(p)
        expect(area(h.frames[h.frames.length - 1])).toBeCloseTo(width * height, 9)
      })
    })
  }

  test('runPreset reports the first refusal with its step number', () => {
    const p = byId('cup')
    const bad: Preset = {
      ...p,
      steps: [
        ...p.steps.slice(0, 3),
        { tool: 'fold', grab: [5, 5], target: [6, 6], layers: 1, kind: 'valley', progress: 1, snapAngle: false },
        ...p.steps.slice(3),
      ],
    }
    expect(runPreset(bad)).toEqual({ ok: false, reason: 'Step 4: That crease misses the paper.' })
  })
})

// ---- per model ----

describe('the paper plane', () => {
  test('has 8 steps on A4', () => {
    const p = byId('plane')
    expect(p.paper).toBe('a4')
    expect(p.steps).toHaveLength(8)
  })

  test('is symmetric about its spine: mirror-image corners land together and the creases mirror', () => {
    const h = history(byId('plane'))
    const f = h.frames[h.frames.length - 1]
    const P = f.vertices_coords
    const cs = paperCorners(f)
    expect(cs).toHaveLength(4)
    // the sheet's long axis (paper space): through the midpoints of the two short sides
    const pairs: [number, number][] = []
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (close(dist(P[cs[i]], P[cs[j]]), 1)) pairs.push([cs[i], cs[j]])
    expect(pairs).toHaveLength(2)
    const mid = ([a, b]: [number, number]): Vec2 => [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2]
    const m0 = mid(pairs[0])
    const m1 = mid(pairs[1])
    expect(dist(m0, m1)).toBeCloseTo(Math.SQRT2, 9)
    const u: Vec2 = [(m1[0] - m0[0]) / Math.SQRT2, (m1[1] - m0[1]) / Math.SQRT2]
    const mirror = (p: Vec2): Vec2 => {
      const t = (p[0] - m0[0]) * u[0] + (p[1] - m0[1]) * u[1]
      const foot: Vec2 = [m0[0] + t * u[0], m0[1] + t * u[1]]
      return [2 * foot[0] - p[0], 2 * foot[1] - p[1]]
    }
    // each short side's two corners are mirror images, and they land on the same folded point
    const ff = foldedFaces(f)
    for (const [a, b] of pairs) expect(dist(foldedVertex(f, a, ff), foldedVertex(f, b, ff))).toBeLessThan(1e-7)
    // every folded crease, mirrored across the spine, lies on a folded crease
    const creases = f.edges_vertices
      .map(([a, b], e) => (Math.abs(f.edges_foldAngle[e]) > 90 ? ([P[a], P[b]] as [Vec2, Vec2]) : null))
      .filter((s): s is [Vec2, Vec2] => s !== null)
    expect(creases.length).toBeGreaterThan(8)
    const onSome = (x: Vec2) =>
      creases.some(([a, b]) => {
        const ab: Vec2 = [b[0] - a[0], b[1] - a[1]]
        const len2 = ab[0] ** 2 + ab[1] ** 2
        const t = ((x[0] - a[0]) * ab[0] + (x[1] - a[1]) * ab[1]) / len2
        const cr = ab[0] * (x[1] - a[1]) - ab[1] * (x[0] - a[0])
        return Math.abs(cr) / Math.sqrt(len2) < 1e-7 && t > -1e-7 && t < 1 + 1e-7
      })
    for (const [a, b] of creases)
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        expect(onSome(mirror(x)), `mirror of crease point ${x}`).toBe(true)
      }
  })

  test('folds to a dart: long and narrow', () => {
    const h = history(byId('plane'))
    const pts = foldedFaces(h.frames[h.frames.length - 1]).flat()
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const len = Math.max(...ys) - Math.min(...ys)
    expect(len).toBeGreaterThan(1.4) // nose to tail: the sheet's whole length
    expect(w).toBeLessThan(0.35) // half the width, less the wings folded down
  })
})

describe('the cup', () => {
  test('has 6 steps on a square', () => {
    const p = byId('cup')
    expect(p.paper).toBe('square')
    expect(p.steps).toHaveLength(6)
  })

  test('folds to the cup trapezoid', () => {
    // square on its diagonal, corners folded across, top flaps down: an
    // isosceles trapezoid, bottom 3√2 − 4, top 2 − √2, height √2 − 1
    const h = history(byId('cup'))
    const H = hull(foldedFaces(h.frames[h.frames.length - 1]).flat())
    expect(H).toHaveLength(4)
    const sides = H.map((p, i) => [p, H[(i + 1) % 4]] as const)
    const lens = sides.map(([a, b]) => dist(a, b))
    const sorted = [...lens].sort((a, b) => a - b)
    const leg = Math.hypot((2 - Math.SQRT2 - (3 * Math.SQRT2 - 4)) / 2, Math.SQRT2 - 1)
    expect(sorted[0]).toBeCloseTo(3 * Math.SQRT2 - 4, 7)
    expect(sorted[1]).toBeCloseTo(leg, 7)
    expect(sorted[2]).toBeCloseTo(leg, 7)
    expect(sorted[3]).toBeCloseTo(2 - Math.SQRT2, 7)
    // top and bottom are opposite and parallel
    const bi = lens.indexOf(sorted[0])
    const ti = lens.indexOf(sorted[3])
    expect((bi + 2) % 4).toBe(ti)
    const d = (i: number): Vec2 => [sides[i][1][0] - sides[i][0][0], sides[i][1][1] - sides[i][0][1]]
    expect(Math.abs(d(bi)[0] * d(ti)[1] - d(bi)[1] * d(ti)[0])).toBeLessThan(1e-7)
  })
})

describe('the crane', () => {
  test('uses at least one squash and two petal folds', () => {
    const p = byId('crane')
    expect(p.paper).toBe('square')
    expect(toolCount(p, 'squash')).toBeGreaterThanOrEqual(1)
    expect(toolCount(p, 'petal')).toBeGreaterThanOrEqual(2)
  })

  test('folds to the crane outline: wing tips together, head and tail far apart', () => {
    const h = history(byId('crane'))
    const f = h.frames[h.frames.length - 1]
    const ff = foldedFaces(f)
    const cs = paperCorners(f).map(v => foldedVertex(f, v, ff))
    expect(cs).toHaveLength(4)
    // the two petal corners stay together at the wing tip; the leg corners became head and tail
    const pairs: [number, number][] = []
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (dist(cs[i], cs[j]) < 1e-7) pairs.push([i, j])
    expect(pairs).toHaveLength(1)
    const wing = cs[pairs[0][0]]
    const [head, tail] = cs.filter((_, i) => !pairs[0].includes(i))
    expect(dist(head, tail)).toBeGreaterThan(0.4)
    expect(dist(head, wing)).toBeGreaterThan(0.25)
    expect(dist(tail, wing)).toBeGreaterThan(0.25)
    // many layers: the crane is a real multi-step model, not a few folds
    expect(f.faces_vertices.length).toBeGreaterThan(60)
  })

  test('neck, tail and head are inside reverse folds: each point goes between its flap\'s halves', () => {
    const p = byId('crane')
    const h = history(p)
    const reverses = p.steps.map((s, i) => (s.tool === 'reverse' ? i : -1)).filter(i => i >= 0)
    expect(reverses).toHaveLength(3)
    for (const i of reverses) {
      expect(h.steps[i].label).toMatch(/^Inside reverse fold · \d+ layers$/)
      const g = p.steps[i] as Gesture
      const before = h.frames[i]
      const after = h.frames[i + 1]
      const flap = new Set(layerAt(before, g.grab).slice(0, g.layers))
      // each face of `after` descends from the face of `before` holding its paper centroid
      const parent = after.faces_vertices.map(vs => {
        const c = centroid(vs.map(v => after.vertices_coords[v]))
        return before.faces_vertices.findIndex(ws => insideConvex(ws.map(w => before.vertices_coords[w]), c))
      })
      expect(parent.every(x => x >= 0)).toBe(true)
      // the reversed point: flap faces that moved (their centroid's folded position changed)
      const pb = poses(before)
      const pa = poses(after)
      const at = (m: number[], q: Vec2): Vec2 => [m[0] * q[0] + m[4] * q[1] + m[12], m[1] * q[0] + m[5] * q[1] + m[13]]
      const moved = after.faces_vertices.map((vs, a) => {
        const c = centroid(vs.map(v => after.vertices_coords[v]))
        return dist(at(pa[a].matrix, c), at(pb[parent[a]].matrix, c)) > 1e-7
      })
      // wherever the point overlaps the flap's unmoved part, it lies strictly between that part's layers
      const pts = foldedFaces(after).filter((_, f) => flap.has(parent[f])).flat()
      const xs = pts.map(q => q[0])
      const ys = pts.map(q => q[1])
      let overlaps = 0
      const N = 36
      for (let a = 0; a < N; a++)
        for (let b = 0; b < N; b++) {
          const q: Vec2 = [
            Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * (a + 0.371)) / N,
            Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * (b + 0.613)) / N,
          ]
          const stack = layerAt(after, q).filter(f => flap.has(parent[f]))
          const pattern = stack.map(f => (moved[f] ? 't' : 'b')).join('')
          if (!pattern.includes('t') || !pattern.includes('b')) continue
          overlaps++
          expect(pattern, `step ${i + 1} at ${q}`).toMatch(/^b+t+b+$/)
          const [, top, , bottom] = pattern.match(/^(b+)(t+)(b+)$/)!
          expect(top.length, `step ${i + 1}: halves`).toBe(bottom.length)
        }
      expect(overlaps, `step ${i + 1}: the point overlaps its flap somewhere`).toBeGreaterThan(0)
    }
  }, 30_000)
})

/** Point in a convex polygon (either winding), boundary excluded. */
function insideConvex(poly: Vec2[], p: Vec2): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (Math.abs(c) < 1e-12) return false
    if (sign === 0) sign = Math.sign(c)
    else if (Math.sign(c) !== sign) return false
  }
  return true
}

test('presets use the engine only through @engine', () => {
  const offenders = globSync('src/presets/**/*.ts')
    .filter(f => !f.endsWith('.test.ts'))
    .filter(f => {
      const src = readFileSync(f, 'utf8')
      const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
      return specs.some(s => s !== '@engine' && !s.startsWith('./'))
    })
  expect(offenders).toEqual([])
})
