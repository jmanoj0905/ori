// How much of the viewport the floating islands cover (CSS px): the Stage
// centres its framing on the area left free. Measured by the studio
// (studio/insets.ts); the type lives here so the renderer needs nothing from it.
export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 }

export const sameInsets = (a: Insets, b: Insets) =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom
