import { afterEach, describe, expect, test, vi } from 'vitest'
import { addCrease, emptyCP } from './cp'
import { birdBase, waterbombBase } from './fixtures'
import { FOLD_ALL_TIMEOUT_MS, NOT_FLAT, TIMED_OUT, createDesignerWorker, foldAll, type WorkerLike } from './foldAll'

afterEach(() => vi.useRealTimers())

/** A worker that never answers (a solver stuck on a hard pattern). */
function stuckWorker() {
  const w: WorkerLike & { posted: unknown[]; terminated: boolean } = {
    onmessage: null, onerror: null, posted: [], terminated: false,
    postMessage(m) { this.posted.push(m) },
    terminate() { this.terminated = true },
  }
  return w
}

describe('Fold all', () => {
  test.each([['waterbomb', waterbombBase], ['bird', birdBase]] as const)('the %s base folds with a valid layer order', async (_, cp) => {
    const r = await foldAll(cp(), new AbortController().signal)
    if (!r.ok) throw new Error(r.reason)
    expect(r.frame.faces_vertices.length).toBeGreaterThan(4)
    expect(r.frame.faceOrders.length).toBeGreaterThan(0)
    expect(r.frame.edges_foldAngle.filter(a => Math.abs(a) === 180).length).toBe(cp().edges_assignment.filter(a => a === 'M' || a === 'V').length)
  })

  test('an invalid pattern is refused within 5 s, listing the failing vertices (Review Focus 3)', async () => {
    let cp = emptyCP({ width: 1, height: 1 })
    cp = addCrease(cp, [0, 0.5], [0.6, 0.5], 'V')
    cp = addCrease(cp, [0.5, 0], [0.5, 0.3], 'M')
    const t0 = performance.now()
    const r = await foldAll(cp, new AbortController().signal)
    expect(performance.now() - t0).toBeLessThan(FOLD_ALL_TIMEOUT_MS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const ends = [[0.6, 0.5], [0.5, 0.3]].map(([x, y]) => cp.vertices_coords.findIndex(p => Math.abs(p[0] - x!) < 1e-9 && Math.abs(p[1] - y!) < 1e-9))
    expect(r.vertices).toEqual(ends.sort((a, b) => a - b))
    expect(r.reason).toBe(`${NOT_FLAT} Check vertices ${r.vertices.join(', ')}.`)
  })

  test('a solve that never finishes is stopped at 5 s in its worker, which is terminated; the next call gets a fresh one', async () => {
    vi.useFakeTimers()
    const workers: ReturnType<typeof stuckWorker>[] = []
    const client = createDesignerWorker(() => {
      const w = stuckWorker()
      workers.push(w)
      return w
    })
    const p = foldAll(waterbombBase(), new AbortController().signal, { worker: client })
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(FOLD_ALL_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    expect(workers[0]!.posted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ ok: false, reason: TIMED_OUT, vertices: [] })
    expect(workers[0]!.terminated).toBe(true)
    void foldAll(waterbombBase(), new AbortController().signal, { worker: client })
    expect(workers).toHaveLength(2)
    client.dispose()
  })

  test('cancelling stops the worker', async () => {
    const w = stuckWorker()
    const client = createDesignerWorker(() => w)
    const ctl = new AbortController()
    const p = foldAll(waterbombBase(), ctl.signal, { worker: client })
    ctl.abort()
    expect(await p).toMatchObject({ ok: false, vertices: [] })
    expect(w.terminated).toBe(true)
  })

  test('replies are matched to their requests', async () => {
    const w = stuckWorker()
    const client = createDesignerWorker(() => w)
    const p = client.run<number>({ kind: 'checks', cp: emptyCP({ width: 1, height: 1 }) })
    const { id } = w.posted[0] as { id: number }
    w.onmessage!({ data: { id: id + 1, result: 'stray' } } as MessageEvent)
    w.onmessage!({ data: { id, result: 42 } } as MessageEvent)
    expect(await p).toBe(42)
  })
})
