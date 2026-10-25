// @engine: the public API (spec §6). The UI imports the engine only from here.
// Runtime exports are exactly the R5 list plus frameFromFold (R60), layerRanks (final review 4a),
// the designer's crease-pattern operations (Plan 5) and hingesAt (Plan 7),
// pinned by api.test.ts; everything else is types. Nothing here imports
// rabbit-ear (only rabbit.ts may).
export { createPaper, PAPER_SIZES, preview, commit, turnOver } from './ops'
export { poses } from './poses'
export { landmarks, snapPoint } from './snap'
export { layerAt, layerRanks } from './layers'
export { hingesAt } from './hinges'
export type { HingeCandidate } from './hinges'
export { frameFromFold } from './fold'
export { axiomLines, patternFrame, foldPattern, commitPattern } from './pattern'
export { sculpt, sculptOf, validSnapshot, SCULPTED } from './sculpt'
export type { SculptSnapshot, SculptParams } from './sculpt'
export { startHistory, push, undo, redo, jumpTo, current, canUndo, canRedo, branch, patternStep } from './history'

export type { Frame, FaceOrder, Vec2, Line, PaperSize, FoldKind, Tool, Result, Ok, Refusal } from './types'
export type { Gesture, Preview, Validity } from './ops'
export type { FacePose } from './poses'
export type { Step, History, PatternParams } from './history'
export type { Landmark } from './snap'
