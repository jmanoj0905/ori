// .fold export (FOLD 1.2): the current frame at the top level, plus the history
// up to the cursor as file_frames so other tools can step through the fold.
// Pure TypeScript; persistence stays React-free.
import { sculptOf, type Frame, type History } from '@engine'

/** A sculpted frame's snapshot larger than this (as JSON) is left out of the file, with a warning. */
export const SCULPT_MAX_BYTES = 1 << 20
export const SCULPT_OMITTED = 'A sculpted (soft paper) shape over 1 MB was left out of the .fold file; its folded steps are kept.'

const big = (f: Frame) => {
  const s = sculptOf(f)
  return s !== null && JSON.stringify(s).length > SCULPT_MAX_BYTES
}

/**
 * Only the FOLD geometry the engine owns; the derived adjacency arrays are left
 * out. A sculpted frame (spec 08) also carries its mesh snapshot as `ori:sculpt`
 * (a FOLD custom field: positions, triangles, paper coordinates), unless it is
 * over SCULPT_MAX_BYTES.
 */
function geometry(f: Frame) {
  const s = sculptOf(f)
  return {
    vertices_coords: f.vertices_coords,
    edges_vertices: f.edges_vertices,
    edges_assignment: f.edges_assignment,
    edges_foldAngle: f.edges_foldAngle,
    faces_vertices: f.faces_vertices,
    faceOrders: f.faceOrders,
    ...(s && !big(f) ? { 'ori:sculpt': s } : {}),
  }
}

/** The warning for a .fold export of `h` that leaves a sculpted shape out, or null. */
export function foldExportWarning(h: History): string | null {
  return h.frames.slice(0, h.cursor + 1).some(big) ? SCULPT_OMITTED : null
}

/**
 * Every exported frame is a crease pattern: vertices_coords are the unfolded
 * sheet and edges_foldAngle describes the fold. ("foldedForm" would tell a
 * consumer the coordinates are already folded, which they are not.)
 */
const classesOf = (_f: Frame): string[] => ['creasePattern']

/**
 * `file_frames[i]` is the frame after i steps (0 = the blank sheet), titled by
 * the step label, each self-contained (`frame_inherit: false`). The top level
 * holds the current frame (the one at the cursor). Steps beyond the cursor
 * (redo) are not exported.
 */
export function toFoldFile(h: History): string {
  const frames = h.frames.slice(0, h.cursor + 1)
  const cur = frames[h.cursor]!
  const file = {
    file_spec: 1.2,
    file_creator: 'Ori',
    file_classes: ['singleModel'],
    frame_title: h.cursor === 0 ? 'Blank sheet' : (h.steps[h.cursor - 1]?.label ?? ''),
    frame_classes: classesOf(cur),
    ...geometry(cur),
    file_frames: frames.map((f, i) => ({
      frame_title: i === 0 ? 'Blank sheet' : (h.steps[i - 1]?.label ?? ''),
      frame_classes: classesOf(f),
      frame_inherit: false,
      ...geometry(f),
    })),
  }
  return JSON.stringify(file)
}
