// The soft-paper quality governor (spec 08 Performance; Plan 6 Task 4): keep
// the soft simulation at 60 fps by giving up quality gracefully — first
// solver iterations (substeps), then mesh resolution.
//
// Every frame reports its time. A frame over BUDGET_MS (16.7) counts as
// slow; SLOW_FRAMES slow frames in a row lower the iterations by one (down to
// the minimum), and only at the minimum does it ask for a coarser mesh (one
// level at a time, up to maxLevel). After RECOVER_FRAMES frames in a row
// under HEADROOM × budget an iteration comes back (up to the starting
// count); a coarsened mesh stays coarse until soft mode is re-entered.
export const BUDGET_MS = 16.7
export const SLOW_FRAMES = 3
export const RECOVER_FRAMES = 60
export const HEADROOM = 0.6

export type GovernorOptions = { iterations?: number; minIterations?: number; maxLevel?: number }

export class QualityGovernor {
  iterations: number
  level = 0
  private readonly max: number
  private readonly min: number
  private readonly maxLevel: number
  private slow = 0
  private fast = 0

  constructor({ iterations = 8, minIterations = 2, maxLevel = 2 }: GovernorOptions = {}) {
    this.iterations = this.max = iterations
    this.min = Math.min(minIterations, iterations)
    this.maxLevel = maxLevel
  }

  /** Report one frame's time (ms). `coarsen`: rebuild the mesh one level coarser now. */
  update(frameMs: number): { iterations: number; coarsen: boolean } {
    let coarsen = false
    if (!Number.isFinite(frameMs) || frameMs <= 0) return { iterations: this.iterations, coarsen }
    if (frameMs > BUDGET_MS) {
      this.fast = 0
      if (++this.slow >= SLOW_FRAMES) {
        this.slow = 0
        if (this.iterations > this.min) this.iterations--
        else if (this.level < this.maxLevel) {
          this.level++
          coarsen = true
        }
      }
    } else {
      this.slow = 0
      if (frameMs < BUDGET_MS * HEADROOM && this.iterations < this.max) {
        if (++this.fast >= RECOVER_FRAMES) {
          this.fast = 0
          this.iterations++
        }
      } else this.fast = 0
    }
    return { iterations: this.iterations, coarsen }
  }
}
