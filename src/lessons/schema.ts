/*
 * The lesson format (spec 06 "Lesson format"; Plan 4 Task 2) and the loader.
 *
 * A lesson is data: `src/lessons/data/<id>.json`, authored by recording the
 * folds (authoring/recordings.ts, the sandbox's devExport) and adding the
 * captions and hints by hand. Each step names the expected tool, the target
 * FOLD frame after the step (checked with `checkStep`), its hint, an optional
 * camera framing and `allowMirror` (accept the sheet's symmetric
 * equivalents), plus `demo`: the recorded gesture that folds the previous
 * step's target into this one. "Show me" plays it, "Skip" commits its
 * result, and keyboard folding offers its grab and target points as
 * landmarks (they are exact points: a fold from `demo.grab` to `demo.target`
 * is the step).
 *
 * Validation is strict and total: `parseLesson` never throws, and
 * `loadLessons` drops every invalid lesson with a console.error naming it
 * (Review Focus 4: a broken file hides that lesson, never the app). Targets
 * go through the engine's `frameFromFold`, and each must be a sheet of the
 * lesson's paper size.
 */
import { PAPER_SIZES, frameFromFold, type FoldKind, type Frame, type Gesture, type PaperSize, type Result, type Tool, type Vec2 } from '@engine'
import { DEFAULT_PAPER, cleanPaper, type PaperSettings, type SheetSize } from '../paper'
import { canonical } from './check'

export type LessonStep = {
  caption: string
  tool: Tool | 'turnOver'
  target: Frame
  hint: string
  camera?: 'top' | 'reset'
  allowMirror?: boolean
  /** The step as a gesture on the previous target ("Show me", Skip, keyboard points). Absent on a turn over. */
  demo?: Gesture
}

export type Lesson = {
  id: string
  title: string
  difficulty: 1 | 2 | 3
  paper: PaperSettings['size']
  material?: Partial<PaperSettings>
  steps: LessonStep[]
}

/** The menu order: the five launch lessons, easiest first. */
export const LAUNCH_LESSONS = ['waterbomb', 'plane', 'cup', 'frog', 'crane'] as const

const TOOLS: readonly string[] = ['fold', 'reverse', 'squash', 'petal']
const KINDS: readonly string[] = ['valley', 'mountain']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isVec = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every(isNum)
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

/** The sheet a lesson's paper names. */
export function sheetOf(size: SheetSize): PaperSize {
  if (size === 'square' || size === 'a4') return PAPER_SIZES[size]
  return { width: size.width, height: size.height }
}

function paperOf(raw: unknown): SheetSize | null {
  if (raw === 'square' || raw === 'a4') return raw
  if (isObj(raw) && isNum(raw.width) && isNum(raw.height) && raw.width > 0 && raw.height > 0 && raw.width <= 1000 && raw.height <= 1000)
    return { width: raw.width, height: raw.height }
  return null
}

/** Only the material fields that survive `cleanPaper` as given (a bad field is dropped, not defaulted). */
function materialOf(raw: unknown): Partial<PaperSettings> | undefined {
  if (!isObj(raw)) return undefined
  const clean = cleanPaper({ ...DEFAULT_PAPER, ...raw })
  const out: Partial<PaperSettings> = {}
  for (const k of ['mode', 'front', 'back', 'pattern', 'thickness', 'translucency'] as const) {
    if (k in raw && clean[k] === raw[k]) (out as Record<string, unknown>)[k] = raw[k]
  }
  return Object.keys(out).length ? out : undefined
}

function demoOf(raw: unknown): Result<{ demo: Gesture }> {
  if (!isObj(raw)) return fail('demo is not a gesture')
  const { tool, grab, target, layers, kind, snapAngle, face } = raw
  if (typeof tool !== 'string' || !TOOLS.includes(tool)) return fail('demo.tool is not a fold tool')
  if (!isVec(grab) || !isVec(target)) return fail('demo grab/target are not finite points')
  if (!Number.isInteger(layers) || (layers as number) < 1) return fail('demo.layers is not a layer count')
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return fail('demo.kind is not valley or mountain')
  const demo: Gesture = {
    tool: tool as Tool,
    grab: [grab[0], grab[1]],
    target: [target[0], target[1]],
    layers: layers as number,
    kind: kind as FoldKind,
    progress: 1,
    snapAngle: snapAngle === true,
  }
  if (face !== undefined) {
    if (!Number.isInteger(face) || (face as number) < 0) return fail('demo.face is not a face id')
    demo.face = face as number
  }
  return { ok: true, demo }
}

function stepOf(raw: unknown, size: PaperSize): Result<{ step: LessonStep }> {
  if (!isObj(raw)) return fail('not an object')
  if (!isText(raw.caption)) return fail('no caption')
  if (!isText(raw.hint)) return fail('no hint')
  const tool = raw.tool
  if (typeof tool !== 'string' || (tool !== 'turnOver' && !TOOLS.includes(tool))) return fail('unknown tool')
  if (raw.target === undefined) return fail('no target')
  const t = frameFromFold(raw.target)
  if (!t.ok) return fail(`target: ${t.reason}`)
  try {
    const c = canonical(t.frame)
    if (Math.abs(c.size.width - size.width) > 1e-6 || Math.abs(c.size.height - size.height) > 1e-6) return fail('target is not on the lesson paper')
  } catch (e) {
    return fail(`target: ${e instanceof Error ? e.message : String(e)}`)
  }
  const step: LessonStep = { caption: raw.caption.trim(), tool: tool as LessonStep['tool'], target: t.frame, hint: raw.hint.trim() }
  if (raw.camera !== undefined) {
    if (raw.camera !== 'top' && raw.camera !== 'reset') return fail('camera is not top or reset')
    step.camera = raw.camera
  }
  if (raw.allowMirror !== undefined) {
    if (typeof raw.allowMirror !== 'boolean') return fail('allowMirror is not a boolean')
    step.allowMirror = raw.allowMirror
  }
  if (tool === 'turnOver') {
    if (raw.demo !== undefined) return fail('a turn over has no demo')
  } else {
    const d = demoOf(raw.demo)
    if (!d.ok) return d
    if (d.demo.tool !== tool) return fail('demo.tool is not the step tool')
    step.demo = d.demo
  }
  return { ok: true, step }
}

/** Validate one lesson's JSON. Never throws. */
export function parseLesson(raw: unknown): Result<{ lesson: Lesson }> {
  if (!isObj(raw)) return fail('not an object')
  const { id, title, difficulty } = raw
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) return fail('id is not a slug')
  if (!isText(title)) return fail(`${id}: no title`)
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) return fail(`${id}: difficulty is not 1, 2 or 3`)
  const paper = paperOf(raw.paper)
  if (!paper) return fail(`${id}: unknown paper`)
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return fail(`${id}: no steps`)
  const size = sheetOf(paper)
  const steps: LessonStep[] = []
  for (const [i, s] of raw.steps.entries()) {
    let r: Result<{ step: LessonStep }>
    try {
      r = stepOf(s, size)
    } catch (e) {
      r = fail(e instanceof Error ? e.message : String(e))
    }
    if (!r.ok) return fail(`${id}: step ${i + 1}: ${r.reason}`)
    steps.push(r.step)
  }
  const lesson: Lesson = { id, title: title.trim(), difficulty, paper, steps }
  const material = materialOf(raw.material)
  if (material) lesson.material = material
  return { ok: true, lesson }
}

const DATA = import.meta.glob('./data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

/** The bundled lesson files, in menu order (LAUNCH_LESSONS first, any others after by file name). */
export function bundledLessons(): unknown[] {
  const rank = (path: string) => {
    const i = (LAUNCH_LESSONS as readonly string[]).indexOf(path.replace(/^.*\/|\.json$/g, ''))
    return i < 0 ? LAUNCH_LESSONS.length : i
  }
  return Object.keys(DATA)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(k => DATA[k])
}

/**
 * The valid lessons (default: the bundled files). An invalid lesson, or a
 * second lesson with an id already taken, is dropped with a console.error;
 * this never throws.
 */
export function loadLessons(raws: readonly unknown[] = bundledLessons()): Lesson[] {
  const out: Lesson[] = []
  for (const raw of raws) {
    const r = parseLesson(raw)
    if (!r.ok) {
      console.error(`Lesson hidden: ${r.reason}`)
      continue
    }
    if (out.some(l => l.id === r.lesson.id)) {
      console.error(`Lesson hidden: ${r.lesson.id}: a lesson with that id is already loaded`)
      continue
    }
    out.push(r.lesson)
  }
  return out
}
