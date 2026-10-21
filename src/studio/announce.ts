// The screen-reader announcer: `announce(text)` appends to the polite live
// region rendered by <LiveLog /> (LiveLog.tsx). A module-level store so any
// code (the keyboard-fold controller, the store watcher) can announce without
// threading props. Also the one place that words a step for a listener.
import { create } from 'zustand'
import type { Step } from '@engine'

export type Announcement = { id: number; text: string }

const KEEP = 20
let nextId = 1

export const useAnnouncements = create<{ items: Announcement[] }>()(() => ({ items: [] }))

/** Write `text` to the polite live region (a new node per call, so repeats are re-read). */
export function announce(text: string): void {
  if (!text) return
  useAnnouncements.setState(s => ({ items: [...s.items, { id: nextId++, text }].slice(-KEEP) }))
}

/** Clear the log (tests). */
export function clearAnnouncements(): void {
  useAnnouncements.setState({ items: [] })
}

const num = (n: number) => String(Number(n.toFixed(1)))

/** "valley fold, top flap, 2 layers, 180 degrees" (spec 04 section 3). */
export function foldWords(tool: string, kind: string, layers: number, angleDeg: number): string {
  const what = tool === 'fold' || tool === undefined ? `${kind} fold` : `${tool} fold`
  return `${what}, top flap, ${layers} ${layers === 1 ? 'layer' : 'layers'}, ${num(angleDeg)} degrees`
}

/** "Step 4: valley fold, top flap, 2 layers, 180 degrees." for the n-th (1-based) step. */
export function stepSentence(step: Step, n: number): string {
  if (step.kind === 'turnOver') return `Step ${n}: turn over.`
  const p = step.params as { tool?: string; kind?: string; layers?: number; angleDeg?: number } | null
  if (!p || typeof p.angleDeg !== 'number' || typeof p.layers !== 'number') return `Step ${n}: ${step.label}.`
  return `Step ${n}: ${foldWords(p.tool ?? 'fold', p.kind ?? 'valley', p.layers, p.angleDeg)}.`
}
