// A single non-blocking notice (toast) slot for persistence messages. Each
// message is shown at most once per session, so a failing autosave does not
// nag on every fold. A vanilla store (no React here): the Notice island reads
// it with zustand's useStore.
import { createStore } from 'zustand/vanilla'

export const RESTORE_FAILED = "Couldn't restore your last model."
export const AUTOSAVE_OFF = 'Autosave is off — your browser storage is full or blocked.'

export const EXPORT_FAILED = "Couldn't export the file."

export type NoticeState = { message: string | null; dismiss(): void }

export const notices = createStore<NoticeState>()(set => ({ message: null, dismiss: () => set({ message: null }) }))

const shown = new Set<string>()

/** Show `message` unless it was already shown this session. */
export function noticeOnce(message: string): void {
  if (shown.has(message)) return
  shown.add(message)
  notices.setState({ message })
}

/** Tests: forget what was shown and clear the slot. */
export function resetNotices(): void {
  shown.clear()
  notices.setState({ message: null })
}

/** Show `message` every time (user-triggered failures such as a PNG export). */
export function notify(message: string): void {
  notices.setState({ message })
}
