// .fold export (FOLD 1.2): the current frame at the top level, plus the history
// up to the cursor as file_frames so other tools can step through the fold.
// Pure TypeScript; persistence stays React-free.
import type { Frame, History } from '@engine'

/** Only the FOLD geometry the engine owns; the derived adjacency arrays are left out. */
function geometry(f: Frame) {
  return {
    vertices_coords: f.vertices_coords,
    edges_vertices: f.edges_vertices,
    edges_assignment: f.edges_assignment,
    edges_foldAngle: f.edges_foldAngle,
    faces_vertices: f.faces_vertices,
    faceOrders: f.faceOrders,
  }
}

/** The blank sheet is a crease pattern with no folds; any other frame is a folded form. */
const classesOf = (f: Frame): string[] => (f.edges_foldAngle.every(a => a === 0) ? ['creasePattern'] : ['foldedForm'])

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
