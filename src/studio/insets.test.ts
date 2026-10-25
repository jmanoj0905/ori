import { describe, expect, test } from 'vitest'
import { BAR_RESERVE_PX, measureInsets } from './insets'

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('measureInsets', () => {
  test('wide: the free area is between the tools and steps islands', () => {
    const i = measureInsets({ width: 1280, height: 800 }, { tools: rect(16, 100, 140, 600), steps: rect(1028, 16, 1264, 700) })
    expect(i).toEqual({ left: 156, right: 268, top: 0, bottom: 0 })
  })
  test('narrow: only the bottom sheet (plus room for the fold bar) takes space', () => {
    const i = measureInsets({ width: 412, height: 900 }, { tools: rect(0, 700, 412, 760), steps: rect(0, 0, 0, 0), dock: rect(0, 760, 412, 900) })
    expect(i).toEqual({ left: 0, right: 0, top: 0, bottom: 140 + BAR_RESERVE_PX })
  })
  test('missing islands add nothing', () => {
    expect(measureInsets({ width: 1280, height: 800 }, {})).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
  })
})
