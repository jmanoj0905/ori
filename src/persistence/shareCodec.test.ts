import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, push, startHistory, turnOver } from '@engine'
import type { Frame, History, Step } from '@engine'
import { DEFAULT_PAPER, type PaperSettings } from '../paper'
import { PRESETS, runPreset } from '../presets'
import { CODEC_VERSION, NEWER, DAMAGED, decodeShare, encodeShare, inflateBounded } from './shareCodec'
import { MAX_RESTORE_STEPS, replayStepOf, replaySave, type ReplayStep } from './replay'
import { deflateSync, strToU8 } from 'fflate'

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const forged = (v: unknown) => 'v1:' + b64(deflateSync(strToU8(JSON.stringify(v))))

function expectFramesMatch(a: Frame, b: Frame) {
  expect(b.faces_vertices).toEqual(a.faces_vertices)
  expect(b.edges_assignment).toEqual(a.edges_assignment)
  expect(b.edges_foldAngle).toEqual(a.edges_foldAngle)
  const av = a.vertices_coords as unknown as number[][]
  const bv = b.vertices_coords as unknown as number[][]
  expect(bv.length).toBe(av.length)
  av.forEach((p, i) => p.forEach((c, k) => expect(Math.abs(c - bv[i]![k]!)).toBeLessThan(1e-4)))
}

/** encode -> decode -> replay through the engine; every frame must match the original. */
function roundTrip(h: History, paper: PaperSettings = DEFAULT_PAPER) {
  const hash = encodeShare(paper, h.steps)
  const d = decodeShare(hash)
  if (!d.ok) throw new Error(d.reason)
  expect(d.steps.map(s => s.kind)).toEqual(h.steps.map(s => s.kind))
  const steps = d.steps.map(s => replayStepOf(s)) as ReplayStep[]
  expect(steps.every(Boolean)).toBe(true)
  const r = replaySave({ paper: d.paper, steps, cursor: steps.length })
  expect(r).not.toBeNull()
  expect(r!.history.frames.length).toBe(h.frames.length)
  h.frames.forEach((f, i) => expectFramesMatch(f, r!.history.frames[i]!))
  return { hash, d }
}

describe('share codec', () => {
  test('version constant', () => expect(CODEC_VERSION).toBe(1))

  for (const p of PRESETS) {
    test(`${p.id} preset replays exactly after a round trip`, () => {
      const run = runPreset(p)
      if (!run.ok) throw new Error(run.reason)
      const { hash } = roundTrip(run.history, { ...DEFAULT_PAPER, size: p.paper })
      expect(hash.startsWith('v1:')).toBe(true)
      expect(hash.includes('#')).toBe(false)
    })
  }

  test('a partial-angle fold and a turn over round-trip', () => {
    let h = startHistory(createPaper(PAPER_SIZES.square))
    const f = commit(h.frames[0]!, { tool: 'fold', grab: [1, 1], target: [0.31, 0.62], layers: 1, kind: 'valley', progress: 0.4, snapAngle: false })
    if (!f.ok) throw new Error(f.reason)
    expect(Math.abs(Number((f.step.params as { angleDeg: number }).angleDeg))).toBeLessThan(180)
    h = push(h, f.step, f.frame)
    const t = turnOver(h.frames[h.cursor]!)
    h = push(h, t.step, t.frame)
    roundTrip(h)
  })

  test('paper settings round-trip, including custom size and pattern', () => {
    const paper: PaperSettings = { mode: 'washi', front: '#2F4A8A', back: '#c9962b', pattern: 'asanoha', thickness: 0.25, translucency: 0.8, size: { width: 3.5, height: 2 } }
    const d = decodeShare(encodeShare(paper, []))
    expect(d).toEqual({ ok: true, paper, steps: [] })
    const a4 = decodeShare(encodeShare({ ...DEFAULT_PAPER, size: 'a4' }, []))
    expect(a4.ok && a4.paper.size).toBe('a4')
  })

  test('accepts a leading #', () => {
    const hash = encodeShare(DEFAULT_PAPER, [])
    expect(decodeShare('#' + hash)).toEqual(decodeShare(hash))
  })

  test('plane preset encodes to under 600 characters', () => {
    const run = runPreset(PRESETS.find(p => p.id === 'plane')!)
    if (!run.ok) throw new Error(run.reason)
    expect(encodeShare({ ...DEFAULT_PAPER, size: 'a4' }, run.history.steps).length).toBeLessThan(600)
  })

  test('every preset stays under the 4096-character soft limit', () => {
    for (const p of PRESETS) {
      const run = runPreset(p)
      if (!run.ok) throw new Error(run.reason)
      expect(encodeShare(DEFAULT_PAPER, run.history.steps).length).toBeLessThan(4096)
    }
  })

  test('a newer version is refused with the newer-Ori message', () => {
    expect(decodeShare('#v9:AAAA')).toEqual({ ok: false, reason: 'This link was made with a newer Ori.' })
    expect(NEWER).toBe('This link was made with a newer Ori.')
  })

  test.each(['', '#', 'garbage', '#v1:', 'v1:!!!!', 'v1:AAAA', 'v1:' + b64(strToU8('not deflate')), 'vx:AAAA', 'v:AAAA', 'v1:a'])(
    'garbage %j is damaged and never throws',
    s => {
      expect(decodeShare(s)).toEqual({ ok: false, reason: 'This link is damaged.' })
    },
  )

  test('a truncated or edited hash is damaged', () => {
    const run = runPreset(PRESETS[0]!)
    if (!run.ok) throw new Error(run.reason)
    const hash = encodeShare(DEFAULT_PAPER, run.history.steps)
    expect(decodeShare(hash.slice(0, hash.length - 12))).toEqual({ ok: false, reason: DAMAGED })
    expect(decodeShare(hash.slice(0, 20) + 'AAAA' + hash.slice(24))).toEqual({ ok: false, reason: DAMAGED })
  })

  const P = [0, 'ff0000', 'ffffff', 0, 500, 0, 0]
  const FOLD = [0, 1, 1, 0, 0, 1, 0, 0, 0, 10000000000, 0, 1800000000]
  test.each([
    ['bad shape', { x: 1 }],
    ['NaN-ish (null)', [P, [[0, null, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1800000]]]],
    ['string coordinate', [P, [[0, '1', 1, 0, 0, 1, 0, 0, 0, 1, 0, 1800000]]]],
    ['unknown tool', [P, [[9, 1, 1, 0, 0, 1, 0]]]],
    ['bad kind', [P, [[1, 1, 1, 0, 0, 1, 7]]]],
    ['bad paper mode', [[9, 'ff0000', 'ffffff', 0, 500, 0, 0], []]],
    ['bad colour', [[0, 'zzzzzz', 'ffffff', 0, 500, 0, 0], []]],
    ['bad size', [[0, 'ff0000', 'ffffff', 0, 500, 0, [0, 5]], []]],
    ['fold missing crease', [P, [[0, 1, 1, 0, 0, 1, 0]]]],
    ['too many steps', [P, Array.from({ length: MAX_RESTORE_STEPS + 1 }, () => [4])]],
  ])('forged payload %s is damaged', (_n, v) => {
    expect(decodeShare(forged(v))).toEqual({ ok: false, reason: DAMAGED })
  })

  test('a well-formed forged payload decodes (sanity for the cases above)', () => {
    expect(decodeShare(forged([P, [FOLD, [4]]])).ok).toBe(true)
    expect(decodeShare(forged([P, Array.from({ length: MAX_RESTORE_STEPS }, () => [4])])).ok).toBe(true)
  })

  test('a decompression bomb is refused fast, without materialising the output', () => {
    const bomb = deflateSync(new Uint8Array(200 * 1024 * 1024)) // ~200 KB of input, 200 MB of output
    const t0 = performance.now()
    expect(() => inflateBounded(bomb)).toThrow(DAMAGED)
    expect(performance.now() - t0).toBeLessThan(200)
  })

  test('a bomb inside the hash-size ceiling is damaged', () => {
    const hash = 'v1:' + b64(deflateSync(new Uint8Array(16 * 1024 * 1024)))
    expect(hash.length).toBeLessThan(32_768)
    expect(decodeShare(hash)).toEqual({ ok: false, reason: DAMAGED })
  })

  test('oversized hashes and non-canonical versions are damaged', () => {
    expect(decodeShare('v1:' + 'A'.repeat(40_000))).toEqual({ ok: false, reason: DAMAGED })
    expect(decodeShare('v01:AAAA')).toEqual({ ok: false, reason: DAMAGED })
    expect(decodeShare('v0:AAAA')).toEqual({ ok: false, reason: DAMAGED })
  })

  test('encode of a non-replayable step does not throw an unrelated error type', () => {
    const bad: Step = { kind: 'fold', params: {}, label: 'x', at: 0 }
    expect(() => encodeShare(DEFAULT_PAPER, [bad])).toThrow()
  })
})
