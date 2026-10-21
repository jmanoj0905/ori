// The non-blocking persistence toast (restore failed, autosave off).
import { useEffect } from 'react'
import { useNotice } from '../../persistence/notice'

export function Notice() {
  const message = useNotice(s => s.message)
  const dismiss = useNotice(s => s.dismiss)
  useEffect(() => {
    if (!message) return
    const t = setTimeout(dismiss, 8000)
    return () => clearTimeout(t)
  }, [message, dismiss])
  if (!message) return null
  return (
    <div className="toast notice" role="status">
      <span>{message}</span>
      <button type="button" className="tbtn text" onClick={dismiss}>Dismiss</button>
    </div>
  )
}
