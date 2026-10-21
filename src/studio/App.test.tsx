// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { App } from './App'

afterEach(cleanup)

test('the shell shows the wordmark, the hint and a host for the Stage', () => {
  const { container } = render(<App />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ori · 折り')
  expect(screen.getByText('Grab a corner and drag it across.')).toBeInTheDocument()
  expect(container.querySelector('[data-stage-host]')).toBeInTheDocument()
})
