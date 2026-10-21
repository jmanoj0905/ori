// PNG export of the current view at 2x (spec 05 phase 1).
import type { Stage } from '../render/Stage'

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * `ori-YYYY-MM-DD-<step>.png`. The date is the LOCAL calendar date (the day the
 * user is living in, not UTC), so callers building a Date from a literal should
 * use the local constructor (`new Date(2026, 9, 20)`).
 */
export const pngName = (date: Date, step: number): string =>
  `ori-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${step}.png`

/** Download `blob` as `name` through a temporary anchor + object URL (revoked afterwards). */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Snapshot the stage at 2x and download it; `step` is the history cursor. */
export async function exportPng(stage: Stage, step: number, transparent: boolean): Promise<void> {
  const blob = await stage.snapshot(2, transparent)
  download(blob, pngName(new Date(), step))
}
