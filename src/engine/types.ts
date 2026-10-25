// Core engine types. Pure TypeScript: nothing here imports rabbit-ear.

export type Vec2 = readonly [number, number]

export type Line = { origin: Vec2; vector: Vec2 }

/** A face-pair layer order, FOLD-style: [faceA, faceB, 1 | -1]. */
export type FaceOrder = readonly [number, number, number]

/**
 * The subset of the FOLD format the engine relies on. Rabbit Ear also fills
 * in adjacency arrays (faces_edges, edges_faces, vertices_vertices, …);
 * those are kept but optional.
 */
export type FOLD = {
  vertices_coords: Vec2[]
  edges_vertices: [number, number][]
  edges_assignment: string[]
  edges_foldAngle: number[]
  faces_vertices: number[][]
  /** Always present (R2): `[]` when no order was ever solved. */
  faceOrders: FaceOrder[]
  faces_edges?: number[][]
  edges_faces?: (number | null | undefined)[][]
  vertices_vertices?: number[][]
  vertices_edges?: number[][]
  vertices_faces?: (number | null | undefined)[][]
  faces_faces?: (number | null | undefined)[][]
  [key: string]: unknown
}

export type Frame = Readonly<FOLD>

export type FoldKind = 'valley' | 'mountain'

export type Tool = 'fold' | 'reverse' | 'squash' | 'petal'

export type Refusal = { ok: false; reason: string }

export type Ok<T> = { ok: true } & T

export type Result<T> = Ok<T> | Refusal

export type PaperSize = { width: number; height: number }
