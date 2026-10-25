import type { Gesture } from '@engine'

/** A turn over, as a preset step (the engine's `turnOver` takes no parameters). */
export type TurnOverStep = { tool: 'turnOver' }

/** One step of a preset: a gesture the UI could also have produced, or a turn over (R6). */
export type PresetStep = Gesture | TurnOverStep

/**
 * A classic model as data: the paper and the steps that fold it, played
 * through `commit` / `turnOver` from a blank sheet. Gesture coordinates are in
 * the folded space of the frame the step applies to.
 */
export type Preset = {
  id: 'plane' | 'cup' | 'crane'
  name: string
  paper: 'square' | 'a4'
  steps: PresetStep[]
}
