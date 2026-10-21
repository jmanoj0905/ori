// Committers: how the studio store turns a released gesture (or a turn over)
// into a new frame. `commit` can take hundreds of milliseconds on a big model
// (R33), so the app runs it in a module Worker (engineWorker.ts) through
// `createWorkerCommitter`; tests (jsdom has no Worker) use `inProcessCommitter`.
// Both share `handleRequest`, so they behave identically.
import { commit, turnOver } from '@engine'
import type { Frame, Gesture, Result, Step } from '@engine'

export type CommitRequest = { frame: Frame; gesture: Gesture } | { frame: Frame; turnOver: true }

export type CommitResult = Result<{ frame: Frame; step: Step }>

/** Commits one request. Rejects only on infrastructure failure (e.g. a dead worker). */
export type Committer = (req: CommitRequest) => Promise<CommitResult>

/** Runs the engine for one request. Pure and synchronous: the Worker's body. */
export function handleRequest(req: CommitRequest): CommitResult {
  return 'turnOver' in req ? turnOver(req.frame) : commit(req.frame, req.gesture)
}

/** Runs the engine on the calling thread (tests, or a no-Worker fallback). */
export const inProcessCommitter: Committer = req => {
  try {
    return Promise.resolve(handleRequest(req))
  } catch (e) {
    return Promise.reject(e)
  }
}

/** Wire format between the client and engineWorker.ts. */
export type WorkerRequest = { id: number; req: CommitRequest }
export type WorkerReply = { id: number; result: CommitResult } | { id: number; error: string }

/** The part of `Worker` the client uses (so tests can pass a stand-in). */
export type WorkerLike = {
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  postMessage(msg: unknown): void
  terminate(): void
}

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' })

/**
 * A committer backed by a module Worker. The worker is created on the first
 * commit (so importing the store never spawns one), replies are matched to
 * requests by id, and a worker error rejects every pending request and drops
 * the worker; the next commit starts a fresh one.
 */
export function createWorkerCommitter(makeWorker: () => WorkerLike = defaultWorker): Committer {
  let worker: WorkerLike | null = null
  let nextId = 0
  const pending = new Map<number, { resolve: (r: CommitResult) => void; reject: (e: Error) => void }>()

  const fail = (w: WorkerLike, message: string) => {
    if (worker === w) worker = null
    w.terminate()
    const all = [...pending.values()]
    pending.clear()
    for (const p of all) p.reject(new Error(message))
  }

  const get = (): WorkerLike => {
    if (worker) return worker
    const w = makeWorker()
    w.onmessage = (e: MessageEvent) => {
      const reply = e.data as WorkerReply
      const p = pending.get(reply.id)
      if (!p) return
      pending.delete(reply.id)
      if ('error' in reply) p.reject(new Error(reply.error))
      else p.resolve(reply.result)
    }
    w.onerror = (e: ErrorEvent) => fail(w, e.message || 'The engine worker failed.')
    worker = w
    return w
  }

  return req =>
    new Promise<CommitResult>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      try {
        get().postMessage({ id, req } satisfies WorkerRequest)
      } catch (e) {
        pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
}
