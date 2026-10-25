// "Fold all" and the background checks (spec 07; Plan 5 Task 3).
//
// Both run in a module Worker (check.worker.ts), so a big or hard pattern
// never blocks the editor (Review Focus 3 and 4):
//   - foldAll checks Kawasaki and Maekawa first and refuses, listing the first
//     failing vertices, without a layer solve; otherwise the engine collapses
//     the pattern (foldPattern: every crease to ±180°, the layer solver for the
//     order). A solve still running after FOLD_ALL_TIMEOUT_MS (5 s) is
//     stopped: the worker is terminated and the next request starts a fresh
//     one. Aborting the signal stops it the same way.
//   - checkPattern returns every vertex issue (the editor debounces it).
// Where Worker is unavailable (tests, old browsers) requests run in process,
// after a macrotask so the caller's frame is not extended.
import { foldPattern, type Frame } from '@engine'
import { vertexIssues, type VertexIssue } from './checks'
import { buildCp, type CP } from './cp'
import { parseCp, parseFold } from '../persistence/cpFormats'

export const FOLD_ALL_TIMEOUT_MS = 5000
/** How many failing vertices a refusal names. */
export const MAX_LISTED = 8
export const NOT_FLAT = 'This crease pattern is not flat-foldable.'
export const TIMED_OUT = 'Fold all took longer than 5 seconds and was stopped.'
export const CANCELLED = 'Fold all was cancelled.'
export const CHECKS_TIMEOUT_MS = 10_000

export type FoldAllResult = { ok: true; frame: Frame } | { ok: false; reason: string; vertices: number[] }

export type DesignerRequest =
  | { kind: 'checks'; cp: CP }
  | { kind: 'foldAll'; cp: CP }
  | { kind: 'import'; format: 'cp' | 'fold'; text: string }

export type ImportResult = { ok: true; cp: CP } | { ok: false; reason: string }
export const IMPORT_EMPTY = 'That file has no crease pattern on a sheet of paper.'

/** Parse a .cp / .fold file and build its crease pattern (in the worker: big files take a while). */
export function importNow(format: 'cp' | 'fold', text: string): ImportResult {
  const r = format === 'cp' ? parseCp(text) : parseFold(text)
  if (!r.ok) return r
  const cp = buildCp(r.segments)
  return cp ? { ok: true, cp } : { ok: false, reason: IMPORT_EMPTY }
}

/** The pattern collapsed flat, or a refusal (failing vertices first). Synchronous: the worker's body. */
export function foldAllNow(cp: CP): FoldAllResult {
  const issues = vertexIssues(cp)
  if (issues.length) {
    const vertices = issues.slice(0, MAX_LISTED).map(i => i.vertex)
    return { ok: false, reason: `${NOT_FLAT} Check vertices ${vertices.join(', ')}.`, vertices }
  }
  const r = foldPattern(cp)
  return r.ok ? { ok: true, frame: r.frame } : { ok: false, reason: r.reason, vertices: [] }
}

export function handleDesignerRequest(req: DesignerRequest): FoldAllResult | VertexIssue[] | ImportResult {
  if (req.kind === 'import') return importNow(req.format, req.text)
  return req.kind === 'checks' ? vertexIssues(req.cp) : foldAllNow(req.cp)
}

// ---- the worker client ----

export type WorkerLike = {
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  postMessage(m: unknown): void
  terminate(): void
}
export type DesignerReply = { id: number; result: unknown } | { id: number; error: string }

export class Stopped extends Error {}

export type DesignerWorker = {
  run<R>(req: DesignerRequest, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<R>
  dispose(): void
}

const inProcess = (): DesignerWorker => ({
  run<R>(req: DesignerRequest, { signal }: { signal?: AbortSignal } = {}) {
    return new Promise<R>((resolve, reject) =>
      setTimeout(() => {
        if (signal?.aborted) return reject(new Stopped(CANCELLED))
        try {
          resolve(handleDesignerRequest(req) as R)
        } catch (e) {
          reject(e)
        }
      }, 0),
    )
  },
  dispose() {},
})

/**
 * A request / reply client over one module Worker, created on first use. A
 * timeout, an abort or a worker error terminates the worker and rejects
 * everything in flight; the next request starts a new worker.
 */
export function createDesignerWorker(make?: () => WorkerLike): DesignerWorker {
  if (!make) {
    if (typeof Worker === 'undefined') return inProcess()
    make = () => new Worker(new URL('./check.worker.ts', import.meta.url), { type: 'module' })
  }
  const spawn = make
  let worker: WorkerLike | null = null
  let next = 0
  const pending = new Map<number, { resolve(r: unknown): void; reject(e: Error): void; done(): void }>()

  const kill = (w: WorkerLike, err: Error) => {
    if (worker === w) worker = null
    w.onmessage = w.onerror = null
    w.terminate()
    const all = [...pending.values()]
    pending.clear()
    for (const p of all) {
      p.done()
      p.reject(err)
    }
  }
  const get = () => {
    if (worker) return worker
    const w = spawn()
    w.onmessage = (e: MessageEvent) => {
      const reply = e.data as DesignerReply
      const p = pending.get(reply.id)
      if (!p) return
      pending.delete(reply.id)
      p.done()
      if ('error' in reply) p.reject(new Error(reply.error))
      else p.resolve(reply.result)
    }
    w.onerror = e => kill(w, new Error(e.message || 'The designer worker failed.'))
    return (worker = w)
  }

  return {
    run<R>(req: DesignerRequest, { timeoutMs = CHECKS_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}) {
      return new Promise<R>((resolve, reject) => {
        if (signal?.aborted) return reject(new Stopped(CANCELLED))
        const id = next++
        const w = get()
        const timer = setTimeout(() => kill(w, new Stopped(TIMED_OUT)), timeoutMs)
        const onAbort = () => kill(w, new Stopped(CANCELLED))
        signal?.addEventListener('abort', onAbort, { once: true })
        pending.set(id, {
          resolve: r => resolve(r as R),
          reject,
          done: () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
          },
        })
        w.postMessage({ id, req })
      })
    },
    dispose() {
      if (worker) kill(worker, new Stopped('The designer worker was closed.'))
    },
  }
}

let shared: DesignerWorker | null = null
const defaultWorker = () => (shared ??= createDesignerWorker())

/** Collapse the whole pattern (see header). Never rejects. */
export async function foldAll(
  cp: CP,
  signal: AbortSignal,
  { worker = defaultWorker(), timeoutMs = FOLD_ALL_TIMEOUT_MS }: { worker?: DesignerWorker; timeoutMs?: number } = {},
): Promise<FoldAllResult> {
  try {
    return await worker.run<FoldAllResult>({ kind: 'foldAll', cp }, { timeoutMs, signal })
  } catch (e) {
    const reason = e instanceof Stopped ? e.message : 'Fold all failed.'
    return { ok: false, reason, vertices: [] }
  }
}

/** Every vertex issue of the pattern, computed in the worker. */
export function checkPattern(cp: CP, { worker = defaultWorker(), signal }: { worker?: DesignerWorker; signal?: AbortSignal } = {}): Promise<VertexIssue[]> {
  return worker.run<VertexIssue[]>({ kind: 'checks', cp }, { signal })
}

export const IMPORT_TIMEOUT_MS = 20_000

/** Import a crease pattern file off the main thread. Never rejects. */
export async function importPattern(format: 'cp' | 'fold', text: string, { worker = defaultWorker() }: { worker?: DesignerWorker } = {}): Promise<ImportResult> {
  try {
    return await worker.run<ImportResult>({ kind: 'import', format, text }, { timeoutMs: IMPORT_TIMEOUT_MS })
  } catch (e) {
    return { ok: false, reason: e instanceof Stopped ? 'The import took too long and was stopped.' : 'That file could not be imported.' }
  }
}
