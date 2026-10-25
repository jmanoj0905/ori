import { afterEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, createPaper } from '@engine'
import type { Gesture } from '@engine'
import {
  COMMIT_TIMEOUT_MS, RESTORE_TIMEOUT_MS, createWorkerCommitter, createWorkerRestorer, handleRequest, inProcessCommitter, inProcessRestorer,
  type WorkerLike, type WorkerReply, type WorkerRequest,
} from './committer'
import { DEFAULT_PAPER } from '../paper'
import type { SavedModel } from '../persistence/replay'

const sheet = createPaper(PAPER_SIZES.square)
const corner: Gesture = { tool: 'fold', grab: [1, 1], target: [0, 0], layers: 1, kind: 'valley', progress: 1, snapAngle: false }

/** A Worker stand-in that runs the engineWorker handler with structured cloning, asynchronously. */
function fakeWorker(): WorkerLike & { posted: number; terminated: boolean } {
  const w = {
    posted: 0,
    terminated: false,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as ((e: MessageEvent) => void) | null,
    postMessage(msg: unknown) {
      w.posted++
      const { id, req } = structuredClone(msg) as WorkerRequest
      const reply: WorkerReply = { id, result: handleRequest(req) }
      queueMicrotask(() => w.onmessage?.({ data: structuredClone(reply) } as MessageEvent))
    },
    terminate() {
      w.terminated = true
    },
  }
  return w
}

describe('committers', () => {
  test('in-process committer commits a gesture', async () => {
    const r = await inProcessCommitter({ frame: sheet, gesture: corner })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.step.kind).toBe('fold')
  })

  test('in-process committer turns over', async () => {
    const r = await inProcessCommitter({ frame: sheet, turnOver: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.step.kind).toBe('turnOver')
  })

  test('in-process committer passes engine refusals through', async () => {
    const r = await inProcessCommitter({ frame: sheet, gesture: { ...corner, grab: [2, 2], target: [3, 3] } })
    expect(r).toEqual({ ok: false, reason: 'That crease misses the paper.' })
  })

  test('worker committer creates its worker lazily and matches replies by id', async () => {
    const w = fakeWorker()
    let made = 0
    const commit = createWorkerCommitter(() => (made++, w))
    expect(made).toBe(0)
    const [a, b] = await Promise.all([
      commit({ frame: sheet, gesture: corner }),
      commit({ frame: sheet, turnOver: true }),
    ])
    expect(made).toBe(1)
    expect(w.posted).toBe(2)
    expect(a.ok && a.step.kind).toBe('fold')
    expect(b.ok && b.step.kind).toBe('turnOver')
  })

  test('a worker error rejects pending commits and the next call makes a new worker', async () => {
    const dead: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} }
    const workers: WorkerLike[] = [dead, fakeWorker()]
    const commit = createWorkerCommitter(() => workers.shift()!)
    const p = commit({ frame: sheet, gesture: corner })
    dead.onerror?.({ message: 'boom' } as ErrorEvent)
    await expect(p).rejects.toThrow('boom')
    const r = await commit({ frame: sheet, gesture: corner })
    expect(r.ok).toBe(true)
  })

  test(`a worker that never answers times out after ${COMMIT_TIMEOUT_MS / 1000} s: rejected, terminated, replaced`, async () => {
    vi.useFakeTimers()
    let terminated = 0
    const silent: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() { terminated++ } }
    const workers: WorkerLike[] = [silent, fakeWorker()]
    const commit = createWorkerCommitter(() => workers.shift()!)
    const p = commit({ frame: sheet, gesture: corner })
    const caught = p.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(COMMIT_TIMEOUT_MS - 1)
    expect(terminated).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect((await caught as Error).message).toMatch(/took too long/)
    expect(terminated).toBe(1)
    vi.useRealTimers()
    const r = await commit({ frame: sheet, gesture: corner })
    expect(r.ok).toBe(true)
  })

  test('a reply that arrives in time clears its timeout', async () => {
    vi.useFakeTimers()
    const w = fakeWorker()
    const commit = createWorkerCommitter(() => w)
    const r = await commit({ frame: sheet, gesture: corner })
    expect(r.ok).toBe(true)
    await vi.advanceTimersByTimeAsync(COMMIT_TIMEOUT_MS * 2)
    expect(w.terminated).toBe(false)
  })

  test('a reply that cannot be deserialised (messageerror) rejects and drops the worker', async () => {
    const w = fakeWorker()
    w.postMessage = () => { w.posted++ } // swallow: the reply "arrives" as a messageerror instead
    const workers: WorkerLike[] = [w, fakeWorker()]
    const commit = createWorkerCommitter(() => workers.shift()!)
    const p = commit({ frame: sheet, gesture: corner })
    w.onmessageerror?.({} as MessageEvent)
    await expect(p).rejects.toThrow()
    expect(w.terminated).toBe(true)
    expect((await commit({ frame: sheet, gesture: corner })).ok).toBe(true)
  })
})

describe('restorers', () => {
  const saved: SavedModel = {
    paper: DEFAULT_PAPER,
    steps: [{ turnOver: true }, { gesture: corner }],
    cursor: 1,
  }

  test('in-process restorer replays the steps', async () => {
    const r = await inProcessRestorer(saved)
    expect(r?.history.steps.map(s => s.kind)).toEqual(['turnOver', 'fold'])
    expect(r?.history.cursor).toBe(1)
  })

  test('worker restorer replays off the main thread and frees its worker', async () => {
    const w = fakeWorker()
    const restore = createWorkerRestorer(() => w)
    const r = await restore(saved)
    expect(w.posted).toBe(1)
    expect(r?.history.steps).toHaveLength(2)
    restore.dispose()
    expect(w.terminated).toBe(true)
  })

  test(`a restore that runs past ${RESTORE_TIMEOUT_MS / 1000} s rejects`, async () => {
    vi.useFakeTimers()
    const silent: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} }
    const restore = createWorkerRestorer(() => silent)
    const caught = restore(saved).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS)
    expect(await caught).toBeInstanceOf(Error)
  })
})

afterEach(() => vi.useRealTimers())
