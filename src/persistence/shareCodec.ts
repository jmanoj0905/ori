// The share-link codec (spec 05 "Share link", Plan 3 task 1). A model is shared
// as its paper settings plus the STEP sequence (never geometry); opening the
// link replays the steps through the engine.
//
// Format: `v<version>:<base64url(deflate(JSON))>` with no leading '#'.
// Payload (version 1): [paper, steps]
//   paper = [modeIdx, front, back, patternIdx, thickness, translucency, size]
//     colours are 6 hex digits without '#'; patternIdx 0 none, 1 seigaiha,
//     2 asanoha; thickness / translucency are integers in thousandths;
//     size is 0 square, 1 a4, or [width, height] in 1e-10 units.
//   step  = [0, gx, gy, tx, ty, layers, kind, cx, cy, vx, vy, angle, face?]  fold
//         | [1|2|3, gx, gy, tx, ty, layers, kind, face?]   reverse | squash | petal
//         | [4]                                             turn over
//     coordinates are integers in 1e-10 units, kind 0 valley / 1 mountain, the
//     fold angle is an integer in 1e-6 degrees (crease origin + vector make a
//     plain fold replay exactly; compound tools replay from grab / target).
//
// Precision (ruling R57): the brief's 1e-5 quantum does NOT replay. A 180 degree
// fold needs a later crease to meet an earlier fold's corner within the engine's
// tolerance; at 1e-5 the plane's second corner fold is refused ("No valid layer
// order exists for this fold."), and at 1e-7 the cup breaks. 1e-9 replays all
// three presets; 1e-10 keeps a margin. Cost: ~10-digit integers per number.
//
// Decoded steps are engine Steps with the same params shape autosave stores
// (so `replayStepOf` / `replaySave` accept them); `label` is the tool's name
// and `at` is 0, since neither affects a replay. Pure: no DOM, no storage.
// Loaded lazily (dynamic import) so fflate stays out of the first-load bundle.
import { Inflate, deflateSync, strToU8 } from 'fflate'
import type { Result, Step } from '@engine'
import { cleanPaper, type PaperSettings } from '../paper'
import { MAX_RESTORE_STEPS, replayStepOf } from './replay'

export const CODEC_VERSION = 1
export const NEWER = 'This link was made with a newer Ori.'
export const DAMAGED = 'This link is damaged.'

const Q = 1e10 // coordinate quantum 1e-10 (1e-5 breaks replay: see below)
const QA = 1e6 // angle quantum 1e-6 degrees
const QU = 1e3 // thickness / translucency
const MAX_JSON_BYTES = 1 << 20 // inflate bound: a hostile link must not balloon
const MAX_HASH_CHARS = 32_768 // far above the 4096-char soft warning
const SLICE = 4096

const MODES = ['kami', 'washi', 'plain', 'custom'] as const
const PATTERNS = [undefined, 'seigaiha', 'asanoha'] as const
const TOOLS = ['fold', 'reverse', 'squash', 'petal'] as const
const HEX6 = /^[0-9a-fA-F]{6}$/
const B64URL = /^[A-Za-z0-9_-]*$/

const q = (n: number, k: number) => Math.round(n * k)
const bad = (): never => {
  throw new Error(DAMAGED)
}

// ---- base64url (no padding) ----

function toB64(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64(t: string): Uint8Array {
  if (!B64URL.test(t) || t.length % 4 === 1) return bad()
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/**
 * Inflate with a hard output bound. fflate allocates a whole push's output
 * before calling back, so the input is fed in small slices (a slice inflates to
 * at most ~1000x its size) and the running total is checked after each: memory
 * never exceeds MAX_JSON_BYTES plus one slice's output.
 */
export function inflateBounded(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  const inf = new Inflate(c => {
    total += c.length
    chunks.push(c)
  })
  for (let i = 0; i < data.length || i === 0; i += SLICE) {
    inf.push(data.subarray(i, i + SLICE), i + SLICE >= data.length)
    if (total > MAX_JSON_BYTES) bad()
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

// ---- encode ----

function packStep(step: Step): number[] {
  if (step.kind === 'turnOver') return [4]
  const rs = replayStepOf(step)
  if (!rs || !('gesture' in rs)) throw new Error('Step cannot be shared')
  const g = rs.gesture
  const head = [TOOLS.indexOf(g.tool as (typeof TOOLS)[number]), q(g.grab[0], Q), q(g.grab[1], Q), q(g.target[0], Q), q(g.target[1], Q), g.layers, g.kind === 'valley' ? 0 : 1]
  const face = g.face === undefined ? [] : [g.face]
  if (g.tool !== 'fold' || !g.crease || g.angleDeg === undefined) return [...head, ...face]
  const c = g.crease
  return [...head, q(c.origin[0], Q), q(c.origin[1], Q), q(c.vector[0], Q), q(c.vector[1], Q), q(g.angleDeg, QA), ...face]
}

function packPaper(p: PaperSettings): unknown[] {
  const size = p.size === 'square' ? 0 : p.size === 'a4' ? 1 : [q(p.size.width, Q), q(p.size.height, Q)]
  return [
    MODES.indexOf(p.mode), p.front.slice(1), p.back.slice(1), PATTERNS.indexOf(p.pattern),
    q(p.thickness, QU), q(p.translucency, QU), size,
  ]
}

/** `v1:<base64url>` (no leading '#') for the paper settings and step sequence. Throws on a step that cannot replay. */
export function encodeShare(paper: PaperSettings, steps: Step[]): string {
  // Sanitise first: a link must never be one its own decoder refuses (out-of-range thickness, bad colour, ...).
  const json = JSON.stringify([packPaper(cleanPaper(paper)), steps.map(packStep)])
  return `v${CODEC_VERSION}:${toB64(deflateSync(strToU8(json), { level: 9 }))}`
}

// ---- decode ----

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isArr = (v: unknown): v is unknown[] => Array.isArray(v)

function unpackPaper(v: unknown): PaperSettings {
  if (!isArr(v) || v.length !== 7) return bad()
  const [m, front, back, pat, th, tr, size] = v
  if (!isInt(m) || !isInt(pat) || !isInt(th) || !isInt(tr)) return bad()
  const mode = MODES[m]
  if (!mode || pat < 0 || pat >= PATTERNS.length) return bad()
  if (typeof front !== 'string' || typeof back !== 'string' || !HEX6.test(front) || !HEX6.test(back)) return bad()
  if (th < 0 || th > QU || tr < 0 || tr > QU) return bad()
  let sz: PaperSettings['size']
  if (size === 0) sz = 'square'
  else if (size === 1) sz = 'a4'
  else if (isArr(size) && size.length === 2 && isInt(size[0]) && isInt(size[1]) && size[0] > 0 && size[1] > 0 && size[0] <= 1000 * Q && size[1] <= 1000 * Q)
    sz = { width: size[0] / Q, height: size[1] / Q }
  else return bad()
  const raw: Record<string, unknown> = { mode, front: '#' + front, back: '#' + back, thickness: th / QU, translucency: tr / QU, size: sz }
  const pattern = PATTERNS[pat]
  if (pattern) raw.pattern = pattern
  return cleanPaper(raw)
}

function unpackStep(v: unknown): Step {
  if (!isArr(v) || v.length < 1 || !v.every(isInt)) return bad()
  const n = v as number[]
  if (n[0] === 4) return n.length === 1 ? { kind: 'turnOver', params: { axisX: 0 } /* placeholder: replay recomputes the axis from the frame */, label: 'Turn over', at: 0 } : bad()
  const tool = TOOLS[n[0]!]
  if (!tool) return bad()
  const fold = tool === 'fold'
  const body = fold ? 12 : 7
  if (n.length !== body && n.length !== body + 1) return bad()
  if (n[6] !== 0 && n[6] !== 1) return bad()
  const params: Record<string, unknown> = {
    tool, grab: [n[1]! / Q, n[2]! / Q], target: [n[3]! / Q, n[4]! / Q], layers: n[5], kind: n[6] === 0 ? 'valley' : 'mountain', snapAngle: false,
  }
  if (fold) {
    params.crease = { origin: [n[7]! / Q, n[8]! / Q], vector: [n[9]! / Q, n[10]! / Q] }
    params.angleDeg = n[11]! / QA
  }
  if (n.length === body + 1) params.face = n[body]
  const step: Step = { kind: tool, params, label: tool, at: 0 }
  return replayStepOf(step) ? step : bad()
}

type Decoded = { paper: PaperSettings; steps: Step[] }

/** Payload decoders by link version. A new format adds an entry; old versions keep decoding. */
export const decoders: Record<number, (payload: unknown) => Result<Decoded>> = {
  1: raw => {
    if (!isArr(raw) || raw.length !== 2 || !isArr(raw[1]) || raw[1].length > MAX_RESTORE_STEPS) return bad()
    return { ok: true, paper: unpackPaper(raw[0]), steps: raw[1].map(unpackStep) }
  },
}

/** The paper and steps for a share hash (with or without '#'), or a refusal. Never throws. */
export function decodeShare(hash: string): Result<Decoded> {
  try {
    const text = hash.startsWith('#') ? hash.slice(1) : hash
    const m = /^v([1-9]\d{0,5}):/.exec(text) // canonical version only (no v01)
    if (!m || text.length > MAX_HASH_CHARS) return bad()
    const version = Number(m[1])
    if (version > Math.max(...Object.keys(decoders).map(Number))) return { ok: false, reason: NEWER }
    const decode = Object.hasOwn(decoders, version) ? decoders[version] : undefined
    if (!decode) return bad()
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflateBounded(fromB64(text.slice(m[0].length)))))
    return decode(raw)
  } catch {
    return { ok: false, reason: DAMAGED }
  }
}
