/*
 * 3D face poses.
 *
 * Each face gets a rigid transform (column-major 4×4) taking its crease-
 * pattern ("paper") coordinates, z = 0, to world space. The face tree is
 * walked breadth-first from root face 0, which keeps the identity pose; each
 * child's pose is its parent's composed with a Rodrigues rotation about the
 * shared crease (in paper coordinates) by that edge's `edges_foldAngle`.
 *
 * Fold sign (FOLD convention, positive = valley): a valley turns the child
 * toward its parent's +z normal (the paper's front), a mountain toward −z.
 * So a valley 90° on the right half of a sheet stands it up at z > 0, and a
 * flat ±180° fold lands every face in the z = 0 plane at its `foldedCoords`
 * position (root face 0 fixed). Layer offsets are NOT included — the
 * renderer separates coplanar stacks.
 *
 * Swing convention (`swing.axis` is a world-space line in the z = 0 plane):
 * the listed faces are additionally rotated, after their tree pose, about the
 * 3D axis through `axis.origin` with direction `axis.vector` by `angleDeg`,
 * using the RIGHT-HAND RULE. Equivalently: a positive angle lifts points lying
 * to the LEFT of `axis.vector` (cross(vector, p − origin) > 0) toward +z, and
 * drops points to its right toward −z. Callers wanting a valley/mountain
 * motion pick the axis direction (or the angle's sign) so that the flap's
 * side and the desired z direction match; flipping `axis.vector` flips the
 * swing.
 */
import type { Frame, Line, Vec2 } from './types'

export type FacePose = { face: number; matrix: number[] }
export type Swing = { faces: number[]; axis: Line; angleDeg: number }
export type Vec3 = [number, number, number]

/** Rigid transform: row-major 3×3 rotation `r` plus translation `t`. */
export type Rigid = { r: number[]; t: Vec3 }

const IDENTITY: Rigid = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }
const DEG = Math.PI / 180

/** Rodrigues rotation by `rad` about the axis through `o` with unit direction `k`. */
export function rotationAbout(o: Vec3, k: Vec3, rad: number): Rigid {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const v = 1 - c
  const [x, y, z] = k
  const r = [
    c + x * x * v, x * y * v - z * s, x * z * v + y * s,
    y * x * v + z * s, c + y * y * v, y * z * v - x * s,
    z * x * v - y * s, z * y * v + x * s, c + z * z * v,
  ]
  const ro = mulVec(r, o)
  return { r, t: [o[0] - ro[0], o[1] - ro[1], o[2] - ro[2]] }
}

const mulVec = (r: number[], p: Vec3): Vec3 => [
  r[0] * p[0] + r[1] * p[1] + r[2] * p[2],
  r[3] * p[0] + r[4] * p[1] + r[5] * p[2],
  r[6] * p[0] + r[7] * p[1] + r[8] * p[2],
]

/** a ∘ b: apply b, then a. */
export function compose(a: Rigid, b: Rigid): Rigid {
  const r = new Array<number>(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a.r[i * 3] * b.r[j] + a.r[i * 3 + 1] * b.r[3 + j] + a.r[i * 3 + 2] * b.r[6 + j]
  const at = mulVec(a.r, b.t)
  return { r, t: [at[0] + a.t[0], at[1] + a.t[1], at[2] + a.t[2]] }
}

export const transform = (m: Rigid, p: Vec3): Vec3 => {
  const q = mulVec(m.r, p)
  return [q[0] + m.t[0], q[1] + m.t[1], q[2] + m.t[2]]
}

/** The world rotation for a swing about a z = 0 line (right-hand rule about `axis.vector`). */
export function swingRigid(axis: Line, angleDeg: number): Rigid {
  const len = Math.hypot(axis.vector[0], axis.vector[1])
  return rotationAbout(
    [axis.origin[0], axis.origin[1], 0],
    [axis.vector[0] / len, axis.vector[1] / len, 0],
    angleDeg * DEG,
  )
}

const toMatrix = ({ r, t }: Rigid): number[] => [
  r[0], r[3], r[6], 0,
  r[1], r[4], r[7], 0,
  r[2], r[5], r[8], 0,
  t[0], t[1], t[2], 1,
]

/** Apply a column-major pose matrix to a paper point (z = 0). */
export function applyPose(m: readonly number[], p: Vec2): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[12], m[1] * p[0] + m[5] * p[1] + m[13], m[2] * p[0] + m[6] * p[1] + m[14]]
}

const treeCache = new WeakMap<Frame, Rigid[]>()

/**
 * Tree poses (no swing) as rigid transforms, indexed by face. O(V + E + F).
 * Cached per frame object (frames are immutable). Faces unreachable from
 * face 0 keep the identity.
 */
export function treePoses(frame: Frame): Rigid[] {
  const hit = treeCache.get(frame)
  if (hit) return hit
  const coords = frame.vertices_coords
  const key = (u: number, v: number) => (u < v ? u * 1048576 + v : v * 1048576 + u)
  const edgeOf = new Map<number, number>()
  frame.edges_vertices.forEach(([u, v], e) => edgeOf.set(key(u, v), e))
  const facesOf = new Map<number, number[]>()
  frame.faces_vertices.forEach((vs, f) =>
    vs.forEach((u, i) => {
      const k = key(u, vs[(i + 1) % vs.length])
      const list = facesOf.get(k)
      if (list) list.push(f)
      else facesOf.set(k, [f])
    }),
  )
  const centroid = (f: number): Vec2 => {
    const vs = frame.faces_vertices[f]
    let x = 0
    let y = 0
    for (const v of vs) {
      x += coords[v][0]
      y += coords[v][1]
    }
    return [x / vs.length, y / vs.length]
  }

  const out: (Rigid | undefined)[] = new Array(frame.faces_vertices.length)
  if (out.length === 0) return []
  out[0] = IDENTITY
  const queue = [0]
  for (let qi = 0; qi < queue.length; qi++) {
    const f = queue[qi]
    const vs = frame.faces_vertices[f]
    vs.forEach((u, i) => {
      const v = vs[(i + 1) % vs.length]
      const k = key(u, v)
      for (const h of facesOf.get(k) ?? []) {
        if (h === f || out[h]) continue
        const e = edgeOf.get(k)
        const a = e === undefined ? '' : frame.edges_assignment[e]
        if (a === 'B' || a === 'b') continue
        const angle = e === undefined ? 0 : (frame.edges_foldAngle[e] ?? 0)
        const pu = coords[u]
        const pv = coords[v]
        const d: Vec2 = [pv[0] - pu[0], pv[1] - pu[1]]
        const len = Math.hypot(d[0], d[1])
        const c = centroid(h)
        // right-hand rotation about d lifts its LEFT side toward +z, so a
        // valley (positive) uses +angle when the child is on the left of d.
        const left = d[0] * (c[1] - pu[1]) - d[1] * (c[0] - pu[0]) > 0
        const hinge = rotationAbout([pu[0], pu[1], 0], [d[0] / len, d[1] / len, 0], (left ? angle : -angle) * DEG)
        out[h] = compose(out[f]!, hinge)
        queue.push(h)
      }
    })
  }
  const result = out.map(m => m ?? IDENTITY)
  treeCache.set(frame, result)
  return result
}

/** Face poses: tree poses, with `swing` applied on top to the listed faces. */
export function poses(frame: Frame, swing?: Swing): FacePose[] {
  const tree = treePoses(frame)
  if (!swing || swing.angleDeg === 0) return tree.map((m, face) => ({ face, matrix: toMatrix(m) }))
  const moving = new Set(swing.faces)
  const s = swingRigid(swing.axis, swing.angleDeg)
  return tree.map((m, face) => ({ face, matrix: toMatrix(moving.has(face) ? compose(s, m) : m) }))
}
