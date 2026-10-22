// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from './App'
import { useSettings, defaultSettings } from '../settings/store'
import { useStudio } from './store'

afterEach(cleanup)

test('the shell shows the wordmark, the hint and a host for the Stage', () => {
  const { container } = render(<App />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ori · 折り')
  expect(screen.getByText('Grab a corner and drag it across.')).toBeInTheDocument()
  expect(container.querySelector('[data-stage-host]')).toBeInTheDocument()
})

test('the gear opens the settings sheet; Esc closes it and focus returns to the gear', async () => {
  render(<App />)
  const gear = screen.getByRole('button', { name: 'Settings' })
  expect(gear).toBeEnabled()
  gear.focus()
  fireEvent.click(gear)
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  expect(dialog).toBeInTheDocument()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(gear).toHaveFocus()
})

test('the studio has a polite fold log', () => {
  render(<App />)
  expect(screen.getByRole('log', { name: 'Fold log' })).toHaveAttribute('aria-live', 'polite')
})

test('the studio opens on the paper defaults from settings', () => {
  useSettings.setState({ ...defaultSettings(), paperDefaults: { ...defaultSettings().paperDefaults, front: '#2F4A8A', size: 'a4', mode: 'plain' } })
  render(<App />)
  expect(useStudio.getState().paper).toMatchObject({ front: '#2F4A8A', size: 'a4', mode: 'plain' })
  useSettings.setState(defaultSettings())
})

test('App restores the autosave on mount; the paper-defaults seed does not overwrite it', async () => {
  const { createStudioStore } = await import('./store')
  const { inProcessCommitter } = await import('./committer')
  const { saveHistory, flushSave, AUTOSAVE_KEY } = await import('../persistence/autosave')
  const { resetBootForTests } = await import('./boot')
  const src = createStudioStore({ committer: inProcessCommitter })
  src.getState().setPaper({ front: '#2F4A8A', mode: 'plain' })
  src.getState().begin([1, 1])
  src.getState().drag([0, 0], 1)
  await src.getState().release()
  saveHistory(src.getState().history, src.getState().paper)
  flushSave()
  // Different defaults: if the seed ran it would replace the restored paper.
  useSettings.setState({ ...defaultSettings(), paperDefaults: { ...defaultSettings().paperDefaults, front: '#D9472B', size: 'a4' } })
  resetBootForTests()
  useStudio.getState().newSheet('square')
  render(<App />)
  // The replay runs off the main thread (in-process in jsdom): it lands after mount.
  await waitFor(() => expect(useStudio.getState().history.steps).toHaveLength(1))
  expect(useStudio.getState().paper).toMatchObject({ front: '#2F4A8A', mode: 'plain', size: 'square' })
  expect(await screen.findByText(/Valley fold/)).toBeInTheDocument()
  cleanup()
  localStorage.removeItem(AUTOSAVE_KEY)
  resetBootForTests()
  useSettings.setState(defaultSettings())
})

test('Export stays disabled while there is no Stage to snapshot', async () => {
  render(<App />)
  const btn = screen.getByRole('button', { name: 'Export' })
  await waitFor(() => expect(btn).toBeDisabled()) // no WebGL in jsdom: stage never becomes ready
})

test('without WebGL the studio says so calmly and the fold and preset controls are disabled', async () => {
  render(<App />) // jsdom has no WebGL: the Stage cannot be built
  expect(await screen.findByRole('alert')).toHaveTextContent('Ori needs WebGL to show the paper.')
  expect(screen.queryByText('Grab a corner and drag it across.')).toBeNull()
  for (const name of ['Paper plane', 'Cup', 'Crane', 'Turn over', 'Reverse']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  const { useUi } = await import('./ui')
  useUi.setState({ stage: 'loading' })
})

test('a 3D view chunk that fails to load asks for a reload', async () => {
  vi.resetModules()
  vi.doMock('../render/Stage', () => Promise.reject(new Error('Failed to fetch dynamically imported module')))
  const { App: Fresh } = await import('./App')
  render(<Fresh />)
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the 3D view — reload to try again.")
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  vi.doUnmock('../render/Stage')
  vi.resetModules()
})

test('an error anywhere in the app shows a calm full-page message instead of a blank page', async () => {
  const { AppBoundary } = await import('./AppBoundary')
  const Boom = () => {
    throw new Error('boom')
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<AppBoundary><Boom /></AppBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Reload to try again.')
  vi.restoreAllMocks()
})
