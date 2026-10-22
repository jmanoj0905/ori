// @vitest-environment jsdom
// The Record dialog (spec 05 "Replay and recording"; Plan 3 Task 5): options,
// WebM hidden without support (Review Focus 4), an accessible progress bar,
// Cancel (no download, Review Focus 5), replay mode for the duration, and a
// notice on failure. The recorder itself is mocked: record.test.ts covers it.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, startHistory } from '@engine'
import type { Gesture } from '@engine'
import { useStudio } from './store'
import { notices, resetNotices, RECORD_FAILED } from '../persistence/notice'

const rec = vi.hoisted(() => ({
  calls: [] as { opts: unknown; signal: AbortSignal; onProgress: (p: number) => void; resolve: (b: Blob) => void; reject: (e: unknown) => void }[],
}))
vi.mock('../persistence/record', async importOriginal => ({
  ...(await importOriginal<typeof import('../persistence/record')>()),
  record: (_p: unknown, _s: unknown, opts: unknown, signal: AbortSignal, onProgress: (p: number) => void) =>
    new Promise<Blob>((resolve, reject) => {
      rec.calls.push({ opts, signal, onProgress, resolve, reject })
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }),
}))
const dl = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('../persistence/png', async importOriginal => ({
  ...(await importOriginal<typeof import('../persistence/png')>()),
  download: dl.download,
}))

import { RecordDialog, type RecordableStage } from './RecordDialog'
import { TopBar } from './islands/TopBar'

const INITIAL = useStudio.getInitialState()
const g = (grab: [number, number], target: [number, number]): Gesture => ({ tool: 'fold', grab, target, layers: 1, kind: 'valley', progress: 1, snapAngle: false })

function twoFolds() {
  let h = startHistory(createPaper(PAPER_SIZES.square))
  for (const x of [g([1, 1], [0, 0]), g([0.5, 0.5], [0, 0.5])]) {
    const r = commit(current(h), x)
    if (!r.ok) throw new Error(r.reason)
    h = push(h, r.step, r.frame)
  }
  return h
}

const stage: RecordableStage = {
  aspect: 1.6,
  setFrame: vi.fn(),
  setPreview: vi.fn(),
  fitModel: vi.fn(),
  beginCapture: vi.fn(),
  captureFrame: vi.fn(),
  endCapture: vi.fn(),
}

const supportWebm = (on: boolean) =>
  vi.stubGlobal('MediaRecorder', on ? { isTypeSupported: (t: string) => t.startsWith('video/webm') } : undefined)

beforeEach(() => {
  useStudio.setState({ ...INITIAL, history: twoFolds() }, true)
  rec.calls.length = 0
  dl.download.mockReset()
  resetNotices()
  HTMLCanvasElement.prototype.captureStream ??= (() => {}) as never
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const start = async (onClose = vi.fn()) => {
  render(<RecordDialog stage={stage} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Record' }))
  await waitFor(() => expect(rec.calls).toHaveLength(1))
  return { onClose, call: rec.calls[0]! }
}

describe('RecordDialog', () => {
  test('without MediaRecorder WebM support the WebM option is hidden (Review Focus 4)', () => {
    supportWebm(false)
    render(<RecordDialog stage={stage} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Record the replay' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /GIF/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /WebM/ })).toBeNull()
  })

  test('with WebM support both formats are offered', () => {
    supportWebm(true)
    render(<RecordDialog stage={stage} onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: /WebM/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /GIF/ })).toBeChecked()
  })

  test('size and frame-rate presets are passed to the recorder', async () => {
    supportWebm(true)
    render(<RecordDialog stage={stage} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /WebM/ }))
    fireEvent.click(screen.getByRole('radio', { name: '1080p' }))
    fireEvent.click(screen.getByRole('radio', { name: '30 fps' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    expect(rec.calls[0]!.opts).toEqual({ format: 'webm', size: 1080, fps: 30 })
  })

  test('recording: replay mode on, an accessible progress bar, then the download and replay mode restored', async () => {
    supportWebm(false)
    const { onClose, call } = await start()
    expect(useStudio.getState().replaying).toBe(true)
    const bar = screen.getByRole('progressbar', { name: 'Recording progress' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    act(() => call.onProgress(0.42))
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    await act(async () => call.resolve(new Blob(['GIF89a'], { type: 'image/gif' })))
    expect(dl.download).toHaveBeenCalledTimes(1)
    expect(dl.download.mock.calls[0]![1]).toMatch(/^ori-\d{4}-\d\d-\d\d-2\.gif$/)
    expect(useStudio.getState().replaying).toBe(false)
    expect(onClose).toHaveBeenCalled()
  })

  test('Cancel aborts the recording: no download, replay mode restored (Review Focus 5)', async () => {
    supportWebm(false)
    const { onClose, call } = await start()
    act(() => call.onProgress(0.3))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    expect(call.signal.aborted).toBe(true)
    expect(dl.download).not.toHaveBeenCalled()
    expect(notices.getState().message).toBeNull() // a cancel is not a failure
    expect(useStudio.getState().replaying).toBe(false)
    expect(onClose).toHaveBeenCalled()
  })

  test('Esc while recording cancels too', async () => {
    supportWebm(false)
    const { call } = await start()
    await act(async () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }))
    expect(call.signal.aborted).toBe(true)
    expect(dl.download).not.toHaveBeenCalled()
  })

  test('unmounting mid-recording aborts it', async () => {
    supportWebm(false)
    const { call } = await start()
    cleanup()
    expect(call.signal.aborted).toBe(true)
    await Promise.resolve()
    expect(useStudio.getState().replaying).toBe(false)
  })

  test('an encoder failure shows the notice and downloads nothing', async () => {
    supportWebm(false)
    const { onClose, call } = await start()
    await act(async () => call.reject(new Error('worker crashed')))
    expect(notices.getState().message).toBe(RECORD_FAILED)
    expect(dl.download).not.toHaveBeenCalled()
    expect(useStudio.getState().replaying).toBe(false)
    expect(onClose).toHaveBeenCalled()
  })

  test('recording from replay mode stays in replay mode afterwards', async () => {
    supportWebm(false)
    useStudio.getState().setReplaying(true)
    const { call } = await start()
    await act(async () => call.resolve(new Blob(['x'], { type: 'image/gif' })))
    expect(useStudio.getState().replaying).toBe(true)
  })

  test('a commit in flight refuses to start (replay mode cannot be entered)', async () => {
    supportWebm(false)
    useStudio.setState({ pending: true })
    render(<RecordDialog stage={stage} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/finish/i))
    expect(rec.calls).toHaveLength(0)
  })
})

describe('TopBar: Record replay…', () => {
  test('the Export menu opens the recorder; off with nothing to replay', () => {
    const onRecord = vi.fn()
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} onExport={() => {}} onRecord={onRecord} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record replay…' }))
    expect(onRecord).toHaveBeenCalledTimes(1)
    cleanup()
    useStudio.setState({ history: startHistory(createPaper(PAPER_SIZES.square)) })
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} onExport={() => {}} onRecord={onRecord} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByRole('button', { name: 'Record replay…' })).toBeDisabled()
  })
})
