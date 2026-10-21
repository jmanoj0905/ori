// A single non-blocking notice (toast) slot for persistence messages. Each
// message is shown at most once per session, so a failing autosave does not
// nag on every fold.
import { create } from 'zustand'

export const RESTORE_FAILED = "Couldn't restore your last model."
export const AUTOSAVE_OFF = 'Autosave is off — your browser storage is full or blocked.'

export type NoticeState = { message: string | null; dismiss(): void }

export const useNotice = create<NoticeState>()(set => ({ message: null, dismiss: () => set({ message: null }) }))

const shown = new Set<string>()

/** Show `message` unless it was already shown this session. */
export function noticeOnce(message: string): void {
  if (shown.has(message)) return
  shown.add(message)
  useNotice.setState({ message })
}

/** Tests: forget what was shown and clear the slot. */
export function resetNotices(): void {
  shown.clear()
  useNotice.setState({ message: null })
}
