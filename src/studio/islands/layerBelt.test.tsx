// @vitest-environment jsdom
// The layer belt island (spec 09): side view, accent on the picked layers, listbox semantics.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Vec2 } from '@engine'
import { LayerBelt } from './LayerBelt'
import { useUi } from '../ui'
import { useStudio } from '../store'
import { BELT_RADIUS_PX, type BeltState } from '../belt'

const INITIAL = useStudio.getInitialState()
// Paper x grows to the right on screen.
const stage = { clientOf: (p: Vec2): Vec2 => [100 + p[0] * 200, 500 - p[1] * 200] }
const belt = (joinX: number): BeltState => ({
  clientX: 300,
  clientY: 200,
  stack: { faces: [4, 7, 2], joins: [{ upper: 0, lower: 1, at: [joinX, 0.5] }] },
  hovered: 1,
  keyboard: false,
})

beforeEach(() => {
  useStudio.setState({ ...INITIAL }, true)
  useStudio.getState().begin([0.25, 0.5])
})
afterEach(() => {
  cleanup()
  useUi.getState().closeBelt()
})

describe('LayerBelt', () => {
  test('closed: renders nothing', () => {
    const { container } = render(<LayerBelt stage={stage} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('a circle at the press point with one option per layer, worded for listeners', () => {
    useUi.getState().openBelt(belt(0.5))
    render(<LayerBelt stage={stage} />)
    const box = screen.getByRole('listbox', { name: 'Layers' })
    expect(box.parentElement).toHaveStyle({ left: `${300 - BELT_RADIUS_PX}px`, top: `${200 - BELT_RADIUS_PX}px` })
    const opts = screen.getAllByRole('option')
    expect(opts.map(o => o.getAttribute('aria-label'))).toEqual([
      'Layer 1 of 3: top flap',
      'Layer 2 of 3: top flap and 1 below',
      'Layer 3 of 3: top flap and 2 below',
    ])
    expect(opts.map(o => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    // the hovered row and those above are the picked ones
    expect(opts.map(o => o.hasAttribute('data-picked'))).toEqual([true, true, false])
  })

  test('a join is drawn on the side it lies toward on screen', () => {
    useUi.getState().openBelt(belt(0.5)) // right of the grab
    const { container, unmount } = render(<LayerBelt stage={stage} />)
    const right = container.querySelector('path')!.getAttribute('d')!
    expect(right).toMatch(/^M \d/)
    expect(right).toMatch(/0 0 1 \d/)
    unmount()
    useUi.getState().openBelt(belt(0)) // left of the grab
    const { container: c2 } = render(<LayerBelt stage={stage} />)
    const left = c2.querySelector('path')!.getAttribute('d')!
    expect(left).toMatch(/^M -\d/)
    expect(left).toMatch(/0 0 0 -\d/)
  })
})
