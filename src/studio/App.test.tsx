// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { App } from './App'

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
