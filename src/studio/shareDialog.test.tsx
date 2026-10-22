// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, startHistory } from '@engine'
import type { Gesture } from '@engine'
import { useStudio } from './store'
import { ShareDialog, LONG_LINK, SHARE_LIMIT } from './ShareDialog'
import { TopBar } from './islands/TopBar'
import { decodeShare } from '../persistence/shareCodec'

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

beforeEach(() => {
  useStudio.setState({ ...INITIAL }, true)
  history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ShareDialog', () => {
  test('shows a link that decodes to the steps up to the cursor (R64)', async () => {
    useStudio.setState({ history: { ...twoFolds(), cursor: 1 } })
    render(<ShareDialog onClose={() => {}} />)
    const field = (await screen.findByRole('textbox', { name: 'Share link' })) as HTMLInputElement
    const hash = field.value.slice(field.value.indexOf('#'))
    expect(hash.startsWith('#v1:')).toBe(true)
    const r = decodeShare(hash)
    expect(r.ok && r.steps).toHaveLength(1)
    expect(screen.queryByText(LONG_LINK)).toBeNull()
  })

  test('Copy writes the URL to the clipboard and says Copied', async () => {
    useStudio.setState({ history: twoFolds() })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<ShareDialog onClose={() => {}} />)
    const field = (await screen.findByRole('textbox', { name: 'Share link' })) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field.value))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  test('without a clipboard it selects the field so the user can copy', async () => {
    useStudio.setState({ history: twoFolds() })
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    document.execCommand = vi.fn(() => false)
    render(<ShareDialog onClose={() => {}} />)
    const field = (await screen.findByRole('textbox', { name: 'Share link' })) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(field.selectionEnd).toBe(field.value.length))
    expect(document.activeElement).toBe(field)
    expect(await screen.findByText(/to copy/)).toBeInTheDocument()
  })

  test('warns and suggests a .fold export when the URL is over 4096 characters', async () => {
    history.replaceState(null, '', '/' + 'a'.repeat(SHARE_LIMIT))
    useStudio.setState({ history: twoFolds() })
    render(<ShareDialog onClose={() => {}} />)
    expect(await screen.findByText(LONG_LINK)).toBeInTheDocument()
    expect(LONG_LINK).toMatch(/\.fold/)
  })

  test('is a labelled modal dialog: focus moves in, Esc closes', async () => {
    useStudio.setState({ history: twoFolds() })
    const onClose = vi.fn()
    render(<ShareDialog onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Share this model' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Share button', () => {
  test('is disabled with nothing to share, and opens the dialog callback otherwise', () => {
    const onShare = vi.fn()
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} onShare={onShare} />)
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
    cleanup()
    useStudio.setState({ history: twoFolds() })
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} onShare={onShare} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(onShare).toHaveBeenCalled()
  })
})

describe('OpenPrompt', () => {
  test('asks "Replace your current model?" and resolves with the choice', async () => {
    const { OpenPrompt } = await import('./islands/OpenPrompt')
    const { askReplace } = await import('./openPrompt')
    render(<OpenPrompt />)
    const answer = askReplace()
    expect(await screen.findByRole('alertdialog', { name: 'Replace your current model?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await answer).toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const again = askReplace()
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
    expect(await again).toBe(true)
  })
})
