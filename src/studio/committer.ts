// Committers and restorers: how the studio store turns a released gesture (or
// a turn over) into a new frame, and how boot replays an autosave. Both can
// take a long time on a big model (R33, R52), so the app runs them in a module
// Worker (engineWorker.ts) through `createWorkerCommitter` /
// `createWorkerRestorer`; tests (jsdom has no Worker) use the in-process ones.
// All share `handleRequest`, so they behave identically.
//
// Bounded (R52): every Worker request has a timeout (COMMIT_TIMEOUT_MS,
// RESTORE_TIMEOUT_MS). A request that runs past it — or a worker that dies
// without an `error` event, or a reply that cannot be deserialised
// (`messageerror`) — terminates the worker and rejects every request in
// flight; the next call starts a fresh worker. The engine's own layer budget
// keeps real folds far below the timeout (the deepest it allows takes ~1 s).
import { commit, turnOver } from '@engine'
import type { Frame, Gesture, Result, Step } from '@engine'
import { replaySave, type Restored, type SavedModel } from '../persistence/replay'

export type CommitRequest = { frame: Frame; gesture: Gesture } | { frame: Frame; turnOver: true }

export type CommitResult = Result<{ frame: Frame; step: Step }>

/** Commits one request. Rejects only on infrastructure failure (a dead or stuck worker). */
export type Committer = (req: CommitRequest) => Promise<CommitResult>

/** Replays a validated save; null when a step does not replay. Rejects on infrastructure failure. */
export type Restorer = (saved: SavedModel) => Promise<Restored | null>

export type RestoreRequest = { replay: SavedModel }
export type EngineRequest = CommitRequest | RestoreRequest

/** A commit taking longer than this is abandoned (the worker is terminated). */
export const COMMIT_TIMEOUT_MS = 20_000
/** A whole restore (every step of the save) taking longer than this is abandoned. */
export const RESTORE_TIMEOUT_MS = 30_000

/** Runs the engine for one request. Pure and synchronous: the Worker's body. */
export function handleRequest(req: CommitRequest): CommitResult
export function handleRequest(req: RestoreRequest): Restored | null
export function handleRequest(req: EngineRequest): CommitResult | Restored | null
export function handleRequest(req: EngineRequest): CommitResult | Restored | null {
  if ('replay' in req) return replaySave(req.replay)
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

export const inProcessRestorer: Restorer = saved => {
  try {
    return Promise.resolve(handleRequest({ replay: saved }))
  } catch (e) {
    return Promise.reject(e)
  }
}

/** Wire format between the client and engineWorker.ts. */
export type WorkerRequest = { id: number; req: EngineRequest }
export type WorkerReply = { id: number; result: unknown } | { id: number; error: string }

/** The part of `Worker` the client uses (so tests can pass a stand-in). */
export type WorkerLike = {
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onmessageerror: ((e: MessageEvent) => void) | null
  postMessage(msg: unknown): void
  terminate(): void
}

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' })

type Client<Req, Res> = ((req: Req) => Promise<Res>) & { dispose(): void }

/**
 * A request/reply client over a module Worker. The worker is created on the
 * first call (so importing the store never spawns one), replies are matched to
 * requests by id, and a worker error, a messageerror or a request's timeout
 * rejects every pending request and drops the worker.
 */
function workerClient<Req extends EngineRequest, Res>(makeWorker: () => WorkerLike, timeoutMs: number): Client<Req, Res> {
  let worker: WorkerLike | null = null
  let nextId = 0
  const pending = new Map<number, { resolve: (r: Res) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  const fail = (w: WorkerLike, message: string) => {
    if (worker === w) worker = null
    w.onmessage = w.onerror = w.onmessageerror = null
    w.terminate()
    const all = [...pending.values()]
    pending.clear()
    for (const p of all) {
      clearTimeout(p.timer)
      p.reject(new Error(message))
    }
  }

  const get = (): WorkerLike => {
    if (worker) return worker
    const w = makeWorker()
    w.onmessage = (e: MessageEvent) => {
      const reply = e.data as WorkerReply
      const p = pending.get(reply.id)
      if (!p) return
      pending.delete(reply.id)
      clearTimeout(p.timer)
      if ('error' in reply) p.reject(new Error(reply.error))
      else p.resolve(reply.result as Res)
    }
    w.onerror = (e: ErrorEvent) => fail(w, e.message || 'The engine worker failed.')
    w.onmessageerror = () => fail(w, 'The engine worker sent an unreadable reply.')
    worker = w
    return w
  }

  const call = (req: Req) =>
    new Promise<Res>((resolve, reject) => {
      const id = nextId++
      let w: WorkerLike
      try {
        w = get()
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
      const timer = setTimeout(() => fail(w, 'The engine took too long.'), timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        w.postMessage({ id, req } satisfies WorkerRequest)
      } catch (e) {
        clearTimeout(timer)
        pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })

  return Object.assign(call, {
    dispose() {
      if (worker) fail(worker, 'The engine worker was closed.')
    },
  })
}

/** A committer backed by a module Worker (see workerClient), COMMIT_TIMEOUT_MS per commit. */
export function createWorkerCommitter(
  makeWorker: () => WorkerLike = defaultWorker,
  { timeoutMs = COMMIT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Committer & { dispose(): void } {
  return workerClient<CommitRequest, CommitResult>(makeWorker, timeoutMs)
}

/** A restorer backed by its own module Worker, RESTORE_TIMEOUT_MS per restore; dispose() frees the worker. */
export function createWorkerRestorer(
  makeWorker: () => WorkerLike = defaultWorker,
  { timeoutMs = RESTORE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Restorer & { dispose(): void } {
  const client = workerClient<RestoreRequest, Restored | null>(makeWorker, timeoutMs)
  return Object.assign((saved: SavedModel) => client({ replay: saved }), { dispose: client.dispose })
}
