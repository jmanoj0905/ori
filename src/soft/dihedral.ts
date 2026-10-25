// The dihedral (hinge) angle of two triangles sharing an edge, and its
// gradient (Bridson, Marino and Fedkiw 2003, "Simulation of clothing with
// folds and wrinkles"), shared by the remesher, the CPU solver and the GPU
// solver's reference. Hinge (a, b, c, d): the edge a → b, with c on the left
// of a → b and d on its right in paper coordinates. The angle follows the
// FOLD convention: 0 when flat, positive for a valley (the paper's front
// faces close up), negative for a mountain, in (−π, π].

type V = ArrayLike<number>

/** Read point i of a flat xyz array. */
const at = (p: V, i: number): [number, number, number] => [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!]
const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

/** The signed hinge angle (radians, FOLD sign: valley > 0) of hinge (a, b, c, d) in positions p. */
export function dihedral(p: V, a: number, b: number, c: number, d: number): number {
  const x3 = at(p, a)
  const x4 = at(p, b)
  const e = sub(x4, x3)
  const n1 = cross(sub(at(p, c), x3), sub(at(p, c), x4))
  const n2 = cross(sub(at(p, d), x4), sub(at(p, d), x3))
  const el = Math.hypot(e[0]!, e[1]!, e[2]!) || 1
  return -Math.atan2(dot(cross(n1, n2), e) / el, dot(n1, n2))
}

/**
 * The gradient of `dihedral` with respect to a, b, c and d (12 numbers:
 * ∂θ/∂a, ∂θ/∂b, ∂θ/∂c, ∂θ/∂d), written into `out`. Zero for a degenerate
 * hinge (a collapsed triangle).
 */
export function dihedralGradient(p: V, a: number, b: number, c: number, d: number, out: Float64Array | number[]): void {
  const x3 = at(p, a)
  const x4 = at(p, b)
  const x1 = at(p, c)
  const x2 = at(p, d)
  const e = sub(x4, x3)
  const n1 = cross(sub(x1, x3), sub(x1, x4))
  const n2 = cross(sub(x2, x4), sub(x2, x3))
  const el = Math.hypot(e[0]!, e[1]!, e[2]!)
  const l1 = dot(n1, n1)
  const l2 = dot(n2, n2)
  if (el < 1e-12 || l1 < 1e-24 || l2 < 1e-24) {
    for (let i = 0; i < 12; i++) out[i] = 0
    return
  }
  const m1 = n1.map(x => (S * x) / l1)
  const m2 = n2.map(x => (S * x) / l2)
  const k1 = dot(sub(x1, x4), e) / el
  const k2 = dot(sub(x2, x4), e) / el
  const k3 = dot(sub(x1, x3), e) / el
  const k4 = dot(sub(x2, x3), e) / el
  for (let i = 0; i < 3; i++) {
    out[i] = k1 * m1[i]! + k2 * m2[i]! // a (x3)
    out[3 + i] = -k3 * m1[i]! - k4 * m2[i]! // b (x4)
    out[6 + i] = el * m1[i]! // c (x1)
    out[9 + i] = el * m2[i]! // d (x2)
  }
}

/** Sign of Bridson's gradient relative to `dihedral` (calibrated by dihedral.test.ts). */
const S = 1
