// Accessible modal behaviour shared by the settings and shortcut sheets:
// focus moves in on open, Tab is trapped, Esc closes, and focus returns to
// what had it before. (ConfirmDialog keeps its own copy: it focuses Cancel.)
import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModal(onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const box = ref.current
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE) ?? box
    first?.focus()
    return () => before?.focus?.()
  }, [])

  // Focus can fall to <body> when the focused control unmounts (a capture ending): Esc must
  // still close the sheet and Tab must bring focus back inside.
  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      const box = ref.current
      if (!box || box.contains(document.activeElement)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        ;(box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus()
      }
    }
    window.addEventListener('keydown', onWindowKey, true)
    return () => window.removeEventListener('keydown', onWindowKey, true)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (!ref.current?.contains(active) || (e.shiftKey && active === first)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return { ref, onKeyDown }
}
