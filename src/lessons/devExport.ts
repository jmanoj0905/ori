/*
 * Lesson authoring (spec 06 "Lessons are authored by recording a sequence in
 * the sandbox, exporting it to lesson data, and adding captions by hand").
 * Dev only: the sandbox's "Export lesson" button (Steps island, DEV builds)
 * and the authoring script (authoring/author.test.ts) turn a history into a
 * lesson skeleton with empty captions and hints, to be filled in by hand.
 *
 * Each step's demo gesture is rebuilt from the step's recorded params (the
 * commit records tool, grab, target, layers, kind, snapAngle and the hit
 * face), so re-committing it on the previous frame folds the same step.
 */
import type { FoldKind, Frame, Gesture, History, Step, Tool, Vec2 } from '@engine'
import type { PaperSettings } from '../paper'

/** A lesson file before validation: JSON-ready (frames stripped to the FOLD fields the engine reads). */
export type LessonJSON = {
  id: string
  title: string
  difficulty: 1 | 2 | 3
  paper: PaperSettings['size']
  material?: Partial<PaperSettings>
  steps: {
    caption: string
    hint: string
    tool: Tool | 'turnOver'
    allowMirror?: boolean
    camera?: 'top' | 'reset'
    demo?: Gesture
    target: Frame
  }[]
}

export type LessonMeta = Pick<LessonJSON, 'id' | 'title' | 'difficulty' | 'paper' | 'material'>

/** The fields a target keeps: the FOLD geometry, assignments, fold angles and the solved layer order. */
export function stripFrame(f: Frame): Frame {
  return {
    vertices_coords: f.vertices_coords.map(p => [p[0], p[1]] as Vec2),
    edges_vertices: f.edges_vertices.map(e => [e[0], e[1]] as [number, number]),
    edges_assignment: [...f.edges_assignment],
    edges_foldAngle: [...f.edges_foldAngle],
    faces_vertices: f.faces_vertices.map(vs => [...vs]),
    faceOrders: f.faceOrders.map(o => [o[0], o[1], o[2]] as const),
  }
}

type Params = { tool?: Tool; grab?: Vec2; target?: Vec2; layers?: number; kind?: FoldKind; snapAngle?: boolean; face?: number }

/** The gesture a history step was committed from; null for a turn over or a step without gesture params. */
export function gestureOf(step: Step): Gesture | null {
  if (step.kind === 'turnOver') return null
  const p = step.params as Params | null
  if (!p || !p.grab || !p.target) return null
  const g: Gesture = {
    tool: p.tool ?? (step.kind as Tool),
    grab: [p.grab[0], p.grab[1]],
    target: [p.target[0], p.target[1]],
    layers: p.layers ?? 1,
    kind: p.kind ?? 'valley',
    progress: 1,
    snapAngle: p.snapAngle === true,
  }
  if (typeof p.face === 'number') g.face = p.face
  return g
}

/** The history up to its cursor as a lesson skeleton: one step per history step, captions and hints empty. */
export function lessonSkeleton(h: History, meta: LessonMeta): LessonJSON {
  const steps = h.steps.slice(0, h.cursor).map((s, i) => {
    // a lesson step is a gesture the learner repeats; a designer pattern is not one
    if (s.kind === 'pattern') throw new Error('A lesson cannot include a crease pattern step.')
    const demo = gestureOf(s)
    const tool: Tool | 'turnOver' = s.kind === 'turnOver' ? 'turnOver' : (demo?.tool ?? s.kind)
    return { caption: '', hint: '', tool, ...(demo ? { demo } : {}), target: stripFrame(h.frames[i + 1]!) }
  })
  return { ...meta, steps }
}
