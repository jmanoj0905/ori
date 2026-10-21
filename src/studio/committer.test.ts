import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, createPaper } from '@engine'
import type { Gesture } from '@engine'
import { createWorkerCommitter, handleRequest, inProcessCommitter, type WorkerLike, type WorkerReply, type WorkerRequest } from './committer'

const sheet = createPaper(PAPER_SIZES.square)
const corner: Gesture = { tool: 'fold', grab: [1, 1], target: [0, 0], layers: 1, kind: 'valley', progress: 1, snapAngle: false }

/** A Worker stand-in that runs the engineWorker handler with structured cloning, asynchronously. */
function fakeWorker(): WorkerLike & { posted: number; terminated: boolean } {
  const w = {
    posted: 0,
    terminated: false,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
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
    const dead: WorkerLike = { onmessage: null, onerror: null, postMessage() {}, terminate() {} }
    const workers: WorkerLike[] = [dead, fakeWorker()]
    const commit = createWorkerCommitter(() => workers.shift()!)
    const p = commit({ frame: sheet, gesture: corner })
    dead.onerror?.({ message: 'boom' } as ErrorEvent)
    await expect(p).rejects.toThrow('boom')
    const r = await commit({ frame: sheet, gesture: corner })
    expect(r.ok).toBe(true)
  })
})
