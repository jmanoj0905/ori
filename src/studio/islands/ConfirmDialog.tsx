// A small in-app confirm (never window.confirm, which blocks the render loop and
// is dismissed by automation). role="alertdialog": focus starts on Cancel, Tab
// is trapped inside, Esc cancels, focus returns to what had it before.
// Reusable: Task 9 uses it for "replace your work with a preset?".
import { useEffect, useId, useRef } from 'react'

export type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm(): void
  onCancel(): void
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => before?.focus?.()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Tab') {
      const items = [...(box.current?.querySelectorAll<HTMLElement>('button') ?? [])]
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      } else if (!box.current?.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="scrim" onKeyDown={onKeyDown}>
      <div ref={box} className="island dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-m`}>
        <h2 id={`${id}-t`}>{title}</h2>
        <p id={`${id}-m`}>{message}</p>
        <div className="dialog-actions">
          <button ref={cancel} type="button" className="tbtn text" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="tbtn text primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
