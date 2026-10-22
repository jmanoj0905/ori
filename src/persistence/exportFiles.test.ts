// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { current, frameFromFold, jumpTo, turnOver, push } from '@engine'
import type { Frame, History } from '@engine'
import { PRESETS, runPreset } from '../presets'
import { toFoldFile } from './foldExport'
import { toCreasePatternSvg } from './svgExport'
import { exportName } from './png'

function planeHistory(): History {
  const run = runPreset(PRESETS.find(p => p.id === 'plane')!)
  if (!run.ok) throw new Error(run.reason)
  return run.history
}

describe('toFoldFile', () => {
  test('is FOLD 1.2 from Ori with the current frame on top and the history as file_frames', () => {
    const h = planeHistory()
    const j = JSON.parse(toFoldFile(h))
    expect(j.file_spec).toBe(1.2)
    expect(j.file_creator).toBe('Ori')
    expect(j.file_classes).toEqual(['singleModel'])
    expect(j.file_frames).toHaveLength(h.cursor + 1)
    expect(j.file_frames.every((f: { frame_inherit: boolean }) => f.frame_inherit === false)).toBe(true)
    expect(j.file_frames[0].frame_classes).toEqual(['creasePattern'])
    expect(j.file_frames[0].frame_title).toBe('Blank sheet')
    expect(j.file_frames[1].frame_title).toBe(h.steps[0]!.label)
    expect(j.file_frames[h.cursor].frame_classes).toContain('foldedForm')
  })

  test('re-imported through frameFromFold: same faces_vertices count and edges_assignment (also every frame)', () => {
    const h = planeHistory()
    const j = JSON.parse(toFoldFile(h))
    const top = frameFromFold(j)
    if (!top.ok) throw new Error(top.reason)
    const cur = current(h)
    expect(top.frame.faces_vertices).toHaveLength(cur.faces_vertices.length)
    expect(top.frame.edges_assignment).toEqual(cur.edges_assignment)
    expect(top.frame.edges_foldAngle).toEqual(cur.edges_foldAngle)
    expect(top.frame.faceOrders).toEqual(cur.faceOrders)
    h.frames.forEach((f: Frame, i) => {
      const r = frameFromFold(j.file_frames[i])
      if (!r.ok) throw new Error(`frame ${i}: ${r.reason}`)
      expect(r.frame.faces_vertices).toHaveLength(f.faces_vertices.length)
      expect(r.frame.edges_assignment).toEqual(f.edges_assignment)
    })
  })

  test('exports only the steps up to the cursor', () => {
    const h = jumpTo(planeHistory(), 3)
    const j = JSON.parse(toFoldFile(h))
    expect(j.file_frames).toHaveLength(4)
    const top = frameFromFold(j)
    if (!top.ok) throw new Error(top.reason)
    expect(top.frame.faces_vertices).toHaveLength(current(h).faces_vertices.length)
  })

  test('a turned-over model exports too', () => {
    const h0 = jumpTo(planeHistory(), 2)
    const t = turnOver(current(h0))
    const j = JSON.parse(toFoldFile(push(h0, t.step, t.frame)))
    expect(frameFromFold(j).ok).toBe(true)
  })

  test('adjacency arrays are not exported (FOLD stays minimal)', () => {
    const j = JSON.parse(toFoldFile(planeHistory()))
    expect(j.faces_edges).toBeUndefined()
    expect(j.vertices_vertices).toBeUndefined()
  })
})

describe('toCreasePatternSvg', () => {
  const frame = () => current(planeHistory())
  const open = (s: string) => s

  test('is a standalone SVG with xmlns, viewBox and px width/height', () => {
    const s = open(toCreasePatternSvg(frame(), { style: 'diagram' }))
    expect(s).toMatch(/<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(s).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/)
    expect(s).toMatch(/width="[\d.]+px"|width="[\d.]+"/)
    expect(new DOMParser().parseFromString(s, 'image/svg+xml').querySelector('parsererror')).toBeNull()
  })

  test('has a boundary path and Yoshizawa–Randlett dashes (diagram)', () => {
    const s = toCreasePatternSvg(frame(), { style: 'diagram' })
    expect(s).toMatch(/<path [^>]*class="cp-boundary"[^>]*d="M/)
    expect(s).toContain('stroke-dasharray="6 4"')
    expect(s).toContain('stroke-dasharray="6 3 1.5 3"')
    const strokes = new Set([...s.matchAll(/stroke="(#[0-9a-f]{3,6})"/g)].map(m => m[1]))
    expect(strokes.size).toBe(1) // one ink
  })

  test('mv-color uses red mountains, blue valleys and keeps the dashes', () => {
    const s = toCreasePatternSvg(frame(), { style: 'mv-color' })
    expect(s).toMatch(/stroke="#c0392b"[^>]*stroke-dasharray="6 3 1.5 3"|stroke-dasharray="6 3 1.5 3"[^>]*stroke="#c0392b"/)
    expect(s).toMatch(/stroke="#1f5fbf"[^>]*stroke-dasharray="6 4"|stroke-dasharray="6 4"[^>]*stroke="#1f5fbf"/)
  })

  test('grid adds n-1 interior lines each way, and none by default', () => {
    const none = toCreasePatternSvg(frame(), { style: 'diagram' })
    expect(none).not.toContain('class="cp-grid"')
    const g = toCreasePatternSvg(frame(), { style: 'diagram', grid: 8 })
    expect((g.match(/class="cp-grid-line"/g) ?? []).length).toBe(14)
  })

  test('re-rooted / mirrored coordinates still fit the viewBox', () => {
    const f = frame()
    const moved: Frame = { ...f, vertices_coords: f.vertices_coords.map(([x, y]) => [-x + 5, y - 7] as [number, number]) }
    const s = toCreasePatternSvg(moved, { style: 'diagram' })
    const [w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s)!.slice(1).map(Number) as [number, number]
    for (const m of s.matchAll(/(?:x|y)[12]="(-?[\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0)
      expect(Number(m[1])).toBeLessThanOrEqual(Math.max(w, h))
    }
    for (const m of s.matchAll(/ d="([^"]+)"/g)) {
      for (const n of m[1]!.match(/-?[\d.]+/g)!) expect(Number(n)).toBeGreaterThanOrEqual(0)
    }
  })

  test('snapshot: the paper plane crease pattern', () => {
    const run = planeHistory()
    expect(toCreasePatternSvg(run.frames[0]!, { style: 'diagram' })).toMatchSnapshot('blank')
    expect(toCreasePatternSvg(current(run), { style: 'diagram', grid: 4 })).toMatchSnapshot('plane')
  })
})

describe('export names', () => {
  test('ori-YYYY-MM-DD-<step>.<ext> on the local date', () => {
    expect(exportName(new Date(2026, 9, 20), 8, 'fold')).toBe('ori-2026-10-20-8.fold')
    expect(exportName(new Date(2026, 0, 5), 0, 'svg')).toBe('ori-2026-01-05-0.svg')
  })
})
