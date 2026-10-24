// @vitest-environment jsdom
// Sculpted (soft paper) steps in the autosave, share links and .fold export
// (Plan 6 Task 5, Review Focus 3): the snapshot is included, or a warning says
// it was too large (over 1 MB).
import { beforeEach, describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, sculpt, startHistory, type Frame, type History, type SculptSnapshot } from '@engine'
import { DEFAULT_PAPER } from '../paper'
import { SCULPT_TOO_LARGE, decodeShare, encodeShare } from './shareCodec'
import { SCULPT_OMITTED, foldExportWarning, toFoldFile } from './foldExport'
import { replayStepOf, replaySave } from './replay'
import { cancelSave, flushSave, loadHistory, saveHistory } from './autosave'
import { resetNotices } from './notice'

/** A small sculpted shape: a 6 × 6 grid of particles, curled. */
function smallSnapshot(n = 6): SculptSnapshot {
  const positions: number[] = []
  const uv: number[] = []
  const tris: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const [u, v] = [i / (n - 1), j / (n - 1)]
      uv.push(u, v)
      positions.push(Math.round(Math.sin(u) * 1e6) / 1e6, v, Math.round((1 - Math.cos(u)) * 1e6) / 1e6)
    }
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i
      tris.push(a, a + 1, a + n + 1, a, a + n + 1, a + n)
    }
  return { positions, tris, uv }
}

function sculptedHistory(snapshot: SculptSnapshot): { h: History; rigid: Frame } {
  const sheet = createPaper(PAPER_SIZES.square)
  const one = commit(sheet, { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false })
  if (!one.ok) throw new Error(one.reason)
  const r = sculpt(one.frame, snapshot)
  if (!r.ok) throw new Error(r.reason)
  return { h: push(push(startHistory(sheet), one.step, one.frame), r.step, r.frame), rigid: one.frame }
}

beforeEach(() => {
  localStorage.clear()
  resetNotices()
  cancelSave()
})

describe('sculpted steps are kept', () => {
  test('in the autosave: the shape comes back, on top of the exact rigid frame', () => {
    const { h, rigid } = sculptedHistory(smallSnapshot())
    saveHistory(h, DEFAULT_PAPER)
    flushSave()
    const back = loadHistory()!
    expect(back.history.steps.map(s => s.kind)).toEqual(['fold', 'sculpted'])
    expect(current(back.history).ori_sculpt).toEqual(smallSnapshot())
    expect(back.history.frames[1]!.faces_vertices).toEqual(rigid.faces_vertices)
  })

  test('in a share link: the snapshot is included and replays exactly', () => {
    const snap = smallSnapshot()
    const { h } = sculptedHistory(snap)
    const d = decodeShare(encodeShare(DEFAULT_PAPER, h.steps))
    if (!d.ok) throw new Error(d.reason)
    expect(d.steps.map(s => s.kind)).toEqual(['fold', 'sculpted'])
    const r = replaySave({ paper: d.paper, steps: d.steps.map(s => replayStepOf(s)!), cursor: 2 })!
    expect(current(r.history).ori_sculpt).toEqual(snap)
  })

  test('a share link with a snapshot over 1 MB is refused with a warning', () => {
    const { h } = sculptedHistory(smallSnapshot(220)) // 48,400 particles
    expect(JSON.stringify(current(h).ori_sculpt).length).toBeGreaterThan(1 << 20)
    expect(() => encodeShare(DEFAULT_PAPER, h.steps)).toThrow(SCULPT_TOO_LARGE)
  })

  test('in a .fold export: the snapshot is in the frame (ori:sculpt), or left out with a warning over 1 MB', () => {
    const small = sculptedHistory(smallSnapshot()).h
    const file = JSON.parse(toFoldFile(small))
    expect(file['ori:sculpt']).toEqual(smallSnapshot())
    expect(file.file_frames[2]['ori:sculpt']).toEqual(smallSnapshot())
    expect(file.file_frames[1]['ori:sculpt']).toBeUndefined()
    expect(foldExportWarning(small)).toBeNull()

    const large = sculptedHistory(smallSnapshot(220)).h
    const big = JSON.parse(toFoldFile(large))
    expect(big['ori:sculpt']).toBeUndefined()
    expect(big.faces_vertices.length).toBeGreaterThan(0) // the folded geometry is still there
    expect(foldExportWarning(large)).toBe(SCULPT_OMITTED)
  })
})
