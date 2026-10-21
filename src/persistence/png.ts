// PNG export of the current view at 2x (spec 05 phase 1).
import { EXPORT_FAILED, notify } from './notice'

/** What the export needs from the renderer (the Stage implements it). */
export type Snapshotter = { snapshot(scale: 2, transparent: boolean): Promise<Blob> }

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * `ori-YYYY-MM-DD-<step>.png`. The date is the LOCAL calendar date (the day the
 * user is living in, not UTC), so callers building a Date from a literal should
 * use the local constructor (`new Date(2026, 9, 20)`).
 */
export const pngName = (date: Date, step: number): string =>
  `ori-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${step}.png`

export const REVOKE_MS = 1000

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
  // Revoke late: some browsers cancel a download whose URL dies at once.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS)
}

/** Snapshot the stage at 2x and download it; `step` is the history cursor. Never rejects: a failure shows a notice. */
export async function exportPng(stage: Snapshotter, step: number, transparent: boolean): Promise<void> {
  try {
    const blob = await stage.snapshot(2, transparent)
    download(blob, pngName(new Date(), step))
  } catch {
    notify(EXPORT_FAILED)
  }
}
