// Curved creases (spec 08 "Curved crease tool"; decision 1 in
// docs/superpowers/decisions/2026-10-24-phase5-open-questions.md): a curve is
// a quadratic Bézier drawn with three clicks (start, control, end) and stored
// as a polyline of CURVE_SEGMENTS straight creases, so the FOLD frame, the
// checks and every export see ordinary edges. It folds in soft mode, where
// the sheet bends into a developable surface; `gaussianCurvature` measures
// that (the angle defect per particle, over a third of its triangles' area).
import type { Vec2 } from '@engine'

export const CURVE_SEGMENTS = 16

/** The quadratic Bézier from p0 to p1 pulled toward c, as CURVE_SEGMENTS + 1 points. */
export function bezier(p0: Vec2, c: Vec2, p1: Vec2, n = CURVE_SEGMENTS): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const d = t * t
    out.push(i === 0 ? [p0[0], p0[1]] : i === n ? [p1[0], p1[1]] : [a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1]])
  }
  return out
}

/**
 * Discrete Gaussian curvature per particle: (2π − the sum of its triangle
 * angles) / (a third of their area). Boundary particles get a meaningless
 * value (their angles do not close a fan); callers skip them.
 */
export function gaussianCurvature(positions: ArrayLike<number>, tris: ArrayLike<number>, n: number): Float64Array {
  const angle = new Float64Array(n)
  const area = new Float64Array(n)
  const P = (i: number) => [positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!]
  for (let t = 0; t < tris.length; t += 3) {
    const ids = [tris[t]!, tris[t + 1]!, tris[t + 2]!]
    const ps = ids.map(P)
    for (let k = 0; k < 3; k++) {
      const o = ps[k]!
      const u = ps[(k + 1) % 3]!.map((x, j) => x - o[j]!)
      const v = ps[(k + 2) % 3]!.map((x, j) => x - o[j]!)
      const dot = u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!
      const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
      const cl = Math.hypot(cr[0]!, cr[1]!, cr[2]!)
      angle[ids[k]!] += Math.atan2(cl, dot)
      area[ids[k]!] += cl / 6 // a third of the triangle's area (|u × v| / 2)
    }
  }
  return Float64Array.from(angle, (a, i) => (area[i]! > 0 ? (2 * Math.PI - a) / area[i]! : 0))
}

/** Solve the n×n system A x = b in place (Gaussian elimination with partial pivoting); null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r
    if (Math.abs(A[p]![c]!) < 1e-14) return null
    ;[A[c], A[p]] = [A[p]!, A[c]!]
    ;[b[c], b[p]] = [b[p]!, b[c]!]
    for (let r = c + 1; r < n; r++) {
      const k = A[r]![c]! / A[c]![c]!
      for (let j = c; j < n; j++) A[r]![j]! -= k * A[c]![j]!
      b[r]! -= k * b[c]!
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!
    for (let j = r + 1; j < n; j++) s -= A[r]![j]! * x[j]!
    x[r] = s / A[r]![r]!
  }
  return x
}

/**
 * Gaussian curvature of the surface shape at particle i (extrinsic): a
 * quadratic height field w = a u² + b uv + c v² + d u + e v + f is fitted by
 * least squares to the particles within `radius` (paper distance) in a frame
 * whose normal is the patch's mean triangle normal; K = (4ac − b²) / (1 + d² + e²)².
 * Unlike the angle defect, this measures the shape at the scale of the patch,
 * not the mesh's own edge-length noise. NaN when the patch is too small.
 */
export function shapeCurvature(positions: ArrayLike<number>, uv: ArrayLike<number>, tris: ArrayLike<number>, i: number, radius: number): number {
  const n = uv.length / 2
  const ids: number[] = []
  for (let j = 0; j < n; j++) if (Math.hypot(uv[2 * j]! - uv[2 * i]!, uv[2 * j + 1]! - uv[2 * i + 1]!) <= radius) ids.push(j)
  if (ids.length < 8) return NaN
  const inPatch = new Set(ids)
  const P = (j: number) => [positions[3 * j]!, positions[3 * j + 1]!, positions[3 * j + 2]!]
  const nrm = [0, 0, 0]
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!]
    if (!inPatch.has(a) || !inPatch.has(b) || !inPatch.has(c)) continue
    const [A, B, C] = [P(a), P(b), P(c)]
    const u = B.map((x, k) => x - A[k]!)
    const v = C.map((x, k) => x - A[k]!)
    nrm[0] += u[1]! * v[2]! - u[2]! * v[1]!
    nrm[1] += u[2]! * v[0]! - u[0]! * v[2]!
    nrm[2] += u[0]! * v[1]! - u[1]! * v[0]!
  }
  const nl = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!)
  if (nl < 1e-12) return NaN
  const N = nrm.map(x => x / nl)
  const seed = Math.abs(N[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const T1 = [seed[1]! * N[2]! - seed[2]! * N[1]!, seed[2]! * N[0]! - seed[0]! * N[2]!, seed[0]! * N[1]! - seed[1]! * N[0]!]
  const tl = Math.hypot(T1[0]!, T1[1]!, T1[2]!)
  const U = T1.map(x => x / tl)
  const V = [N[1]! * U[2]! - N[2]! * U[1]!, N[2]! * U[0]! - N[0]! * U[2]!, N[0]! * U[1]! - N[1]! * U[0]!]
  const o = P(i)
  const A = Array.from({ length: 6 }, () => new Array<number>(6).fill(0))
  const b = new Array<number>(6).fill(0)
  for (const j of ids) {
    const d = P(j).map((x, k) => x - o[k]!)
    const u = d[0]! * U[0]! + d[1]! * U[1]! + d[2]! * U[2]!
    const v = d[0]! * V[0]! + d[1]! * V[1]! + d[2]! * V[2]!
    const w = d[0]! * N[0]! + d[1]! * N[1]! + d[2]! * N[2]!
    const row = [u * u, u * v, v * v, u, v, 1]
    for (let r = 0; r < 6; r++) {
      b[r] += row[r]! * w
      for (let c = 0; c < 6; c++) A[r]![c] += row[r]! * row[c]!
    }
  }
  const x = solve(A, b)
  if (!x) return NaN
  const [qa, qb, qc, qd, qe] = x as [number, number, number, number, number]
  return (4 * qa * qc - qb * qb) / (1 + qd * qd + qe * qe) ** 2
}

/**
 * Fold the sheet along a curved crease, exactly (decision 1 in the phase 5
 * decisions): a mesh of triangles cannot bend along a curve's rulings without
 * stretching (it locks), so the fold is built, not simulated. One panel is
 * bent into a cylinder whose rulings cross the crease's chord at right
 * angles; the other is that cylinder's continuation reflected across a plane
 * through the crease. Both steps are isometries, so the folded sheet is
 * developable everywhere off the crease, and the crease lies in the plane.
 *
 *   crease: the crease polyline's vertices, in order from one end to the
 *     other (paper); it must be a graph over its chord (no doubling back).
 *     Mesh the sheet with `curveRulings(crease)` as rulings so each panel
 *     folds along mesh edges.
 *   angleDeg: how far to fold, 0 (flat) … < 90: the reflection plane's tilt.
 *     The crease's fold angle grows with it (it varies along a curved
 *     crease).
 *   valley: which way the paper closes (true: the front closes, FOLD's +).
 *
 * Returns world positions (xyz per particle) for paper points `uv` (xy per
 * particle), or null when the crease is not a graph over its chord or the
 * angle is too steep for its slope (|cot φ · c′| must stay below 1).
 */
export function curvedFold(uv: ArrayLike<number>, crease: readonly Vec2[], angleDeg: number, valley: boolean): Float32Array | null {
  const n = uv.length / 2
  const out = new Float32Array(3 * n)
  if (crease.length < 2) return null
  const o = crease[0]!
  const end = crease.at(-1)!
  const L = Math.hypot(end[0] - o[0], end[1] - o[1])
  if (L < 1e-9) return null
  const ex = [(end[0] - o[0]) / L, (end[1] - o[1]) / L]
  const ey = [-ex[1]!, ex[0]!]
  const local = (p: readonly number[]) => [(p[0]! - o[0]) * ex[0]! + (p[1]! - o[1]) * ex[1]!, (p[0]! - o[0]) * ey[0]! + (p[1]! - o[1]) * ey[1]!] as const
  const cs = crease.map(local)
  for (let i = 1; i < cs.length; i++) if (cs[i]![0] <= cs[i - 1]![0]) return null // doubles back
  // c(x): the crease's height over the chord, linear between its points and
  // extended at the ends. The cylinder then has a kink over each crease
  // vertex: the panels fold along those rulings (curveRulings), which the
  // remesher makes mesh edges, so every triangle maps rigidly.
  const c = (x: number): number => {
    let i = 1
    while (i < cs.length - 1 && cs[i]![0] < x) i++
    const [a, b] = [cs[i - 1]!, cs[i]!]
    return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])
  }
  const phi = ((90 - Math.min(Math.max(angleDeg, 0), 89.9)) * Math.PI) / 180 // plane tilt: 90° is flat
  const cot = Math.cos(phi) / Math.sin(phi)
  // the cylinder's cross-section, arc-length parametrised: z(x) = −cot φ (c(x) − c(0)), x(s) from √(1 − z′²)
  let lo = 0, hi = L
  for (let k = 0; k < n; k++) {
    const [x] = local([uv[2 * k]!, uv[2 * k + 1]!])
    lo = Math.min(lo, x)
    hi = Math.max(hi, x)
  }
  const N = 2048
  const dx = (hi - lo) / N
  const X = new Float64Array(N + 1)
  const Z = new Float64Array(N + 1)
  const c0 = c(0)
  for (let k = 0; k <= N; k++) Z[k] = -cot * (c(lo + k * dx) - c0)
  for (let k = 1; k <= N; k++) {
    const dz = (Z[k]! - Z[k - 1]!) / dx
    if (Math.abs(dz) >= 1) return null // too steep for this slope
    X[k] = X[k - 1]! + Math.sqrt(1 - dz * dz) * dx
  }
  const at = (x: number): [number, number] => {
    const f = Math.min(N, Math.max(0, (x - lo) / dx))
    const k = Math.min(N - 1, Math.floor(f))
    const t = f - k
    return [X[k]! + (X[k + 1]! - X[k]!) * t, Z[k]! + (Z[k + 1]! - Z[k]!) * t]
  }
  // shift so that x = 0 maps to 0
  const [x0] = at(0)
  const nY = Math.cos(phi)
  const nZ = Math.sin(phi)
  const d = nY * c0 // the plane: cos φ · y + sin φ · z = d  ⇔  y = c(x) on the cylinder
  const s = valley ? -1 : 1 // the construction closes the back; flip z for a valley
  for (let k = 0; k < n; k++) {
    const [x, y] = local([uv[2 * k]!, uv[2 * k + 1]!])
    const [cx, cz] = at(x)
    let P = [cx - x0, y, cz]
    if (y > c(x)) {
      // the far panel: reflect across the plane
      const dist = nY * P[1]! + nZ * P[2]! - d
      P = [P[0]!, P[1]! - 2 * dist * nY, P[2]! - 2 * dist * nZ]
    }
    // back to paper axes (the chord frame), z flipped for a mountain
    out[3 * k] = o[0] + P[0]! * ex[0]! + P[1]! * ey[0]!
    out[3 * k + 1] = o[1] + P[0]! * ex[1]! + P[1]! * ey[1]!
    out[3 * k + 2] = s * P[2]!
  }
  return out
}

/**
 * The rulings a polyline crease's fold bends along (see curvedFold): through
 * each inner vertex of the crease, at right angles to its chord, long enough
 * to cross a sheet of size `extent`.
 */
export function curveRulings(crease: readonly Vec2[], extent = 4): [Vec2, Vec2][] {
  if (crease.length < 3) return []
  const o = crease[0]!
  const end = crease.at(-1)!
  const L = Math.hypot(end[0] - o[0], end[1] - o[1]) || 1
  const ey: Vec2 = [-(end[1] - o[1]) / L, (end[0] - o[0]) / L]
  return crease.slice(1, -1).map(p => [
    [p[0] - ey[0] * extent, p[1] - ey[1] * extent],
    [p[0] + ey[0] * extent, p[1] + ey[1] * extent],
  ])
}
