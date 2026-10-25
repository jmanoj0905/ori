// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SoftModeToggle } from './SoftModeToggle'
import { NO_WEBGPU, useSoftUi } from './softUi'
import { useSettings } from '../settings/store'

afterEach(() => {
  cleanup()
  useSettings.getState().update({ softPaper: false })
  useSoftUi.getState().set({ active: false, wet: false, curves: 0 })
})

describe('the soft paper toggle', () => {
  test('without WebGPU the toggle is hidden and the tooltip explains why', () => {
    useSettings.getState().update({ softPaper: true })
    render(<SoftModeToggle gpu={false} onToggle={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Soft paper' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Wet' })).toBeNull()
    const note = screen.getByRole('note', { name: NO_WEBGPU })
    expect(note).toHaveAttribute('title', NO_WEBGPU)
    expect(NO_WEBGPU).toMatch(/WebGPU/)
  })

  test('off in settings (the default): nothing is shown at all', () => {
    const { container } = render(<SoftModeToggle gpu onToggle={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('with WebGPU: Soft paper toggles, Wet only while soft, Curve fold when the model has curves', () => {
    useSettings.getState().update({ softPaper: true })
    const onToggle = vi.fn()
    const onWet = vi.fn()
    const onCurve = vi.fn()
    const { rerender } = render(<SoftModeToggle gpu onToggle={onToggle} onWet={onWet} onCurve={onCurve} />)
    expect(screen.getByRole('button', { name: 'Wet' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Soft paper' }))
    expect(onToggle).toHaveBeenCalledWith(true)
    useSoftUi.getState().set({ active: true, curves: 1, curveDeg: 0, solver: 'gpu' })
    rerender(<SoftModeToggle gpu onToggle={onToggle} onWet={onWet} onCurve={onCurve} />)
    expect(screen.getByRole('button', { name: 'Soft paper' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Wet' }))
    expect(onWet).toHaveBeenCalledWith(true)
    fireEvent.change(screen.getByRole('slider', { name: 'Curve fold' }), { target: { value: '25' } })
    expect(onCurve).toHaveBeenCalledWith(25)
  })

  test('the setting itself: without WebGPU the switch is hidden and a note explains why', async () => {
    const { SoftPaperSetting } = await import('./SettingsSheet')
    render(<SoftPaperSetting gpu={false} />)
    expect(screen.queryByRole('checkbox', { name: /Soft paper/ })).toBeNull()
    expect(screen.getByRole('note')).toHaveAttribute('title', NO_WEBGPU)
    cleanup()
    render(<SoftPaperSetting gpu />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Soft paper/ }))
    expect(useSettings.getState().softPaper).toBe(true)
  })
})
