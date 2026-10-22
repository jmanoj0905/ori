// @engine: the public API (spec §6). The UI imports the engine only from here.
// Runtime exports are exactly the R5 list plus frameFromFold (R60) and layerRanks (final review 4a),
// pinned by api.test.ts; everything else is types. Nothing here imports
// rabbit-ear (only rabbit.ts may).
export { createPaper, PAPER_SIZES, preview, commit, turnOver } from './ops'
export { poses } from './poses'
export { landmarks, snapPoint } from './snap'
export { layerAt, layerRanks } from './layers'
export { frameFromFold } from './fold'
export { startHistory, push, undo, redo, jumpTo, current, canUndo, canRedo } from './history'

export type { Frame, FaceOrder, Vec2, Line, PaperSize, FoldKind, Tool, Result, Ok, Refusal } from './types'
export type { Gesture, Preview, Validity } from './ops'
export type { FacePose } from './poses'
export type { Step, History } from './history'
export type { Landmark } from './snap'
