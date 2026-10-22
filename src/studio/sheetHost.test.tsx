// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { announce as _a, clearAnnouncements, useAnnouncements } from './announce'
import { makeSheetHost } from './SheetHost'
import { useUi } from './ui'
import { notices, resetNotices } from '../persistence/notice'

void _a
beforeEach(() => {
  useUi.setState({ sheet: null, kf: 'idle' })
  clearAnnouncements()
  resetNotices()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const Ok = ({ onClose }: { onClose(): void }) => <button onClick={onClose}>sheet ok</button>

test('a failed chunk load closes the sheet, announces it, keeps the app mounted, and the next open retries', async () => {
  const settings = vi.fn()
    .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
    .mockResolvedValue({ default: Ok })
  const Host = makeSheetHost(settings, () => Promise.resolve({ default: Ok }))
  render(<><p>app still here</p><Host /></>)
  act(() => useUi.getState().open('settings'))
  await waitFor(() => expect(useUi.getState().sheet).toBeNull())
  expect(screen.getByText('app still here')).toBeInTheDocument()
  expect(useAnnouncements.getState().items.map(i => i.text)).toContain("Couldn't open settings. Check your connection and try again.")
  expect(notices.getState().message).toBe("Couldn't open settings. Check your connection and try again.") // visible too
  expect(screen.queryByText('sheet ok')).toBeNull()
  act(() => useUi.getState().open('settings'))
  expect(await screen.findByText('sheet ok')).toBeInTheDocument()
  expect(settings).toHaveBeenCalledTimes(2) // a fresh import(), not the cached rejection
})

test('the shortcut sheet fails the same way', async () => {
  const Host = makeSheetHost(() => Promise.resolve({ default: Ok }), () => Promise.reject(new Error('x')))
  render(<Host />)
  act(() => useUi.getState().open('shortcuts'))
  await waitFor(() => expect(useUi.getState().sheet).toBeNull())
  expect(useAnnouncements.getState().items.some(i => /shortcut sheet/.test(i.text))).toBe(true)
})
