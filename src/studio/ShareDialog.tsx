// The Share dialog (spec 05 "Share link"): the link for the model as the viewer
// sees it (steps up to the cursor, R64) and the current paper. The codec loads on
// demand (R58). Copy uses the async clipboard, falling back to selecting the
// field so the user can copy by hand. A link over 4096 characters still works
// but warns and points at a .fold export. Accessible like the sheets (useModal).
import { useEffect, useId, useRef, useState } from 'react'
import { useStudio } from './store'
import { useModal } from './useModal'

export const SHARE_LIMIT = 4096
export const LONG_LINK = 'This link is long and may not work everywhere. Consider exporting a .fold file instead.'

type Link = { state: 'working' } | { state: 'ready'; url: string } | { state: 'failed' }

export function ShareDialog({ onClose }: { onClose(): void }) {
  const { ref, onKeyDown } = useModal(onClose)
  const id = useId()
  const history = useStudio(s => s.history)
  const paper = useStudio(s => s.paper)
  const [link, setLink] = useState<Link>({ state: 'working' })
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setCopy('idle')
    import('../persistence/shareCodec')
      .then(m => {
        if (!live) return
        const code = m.encodeShare(paper, history.steps.slice(0, history.cursor))
        setLink({ state: 'ready', url: `${location.origin}${location.pathname}${location.search}#${code}` })
      })
      .catch(() => live && setLink({ state: 'failed' }))
    return () => {
      live = false
    }
  }, [history, paper])

  const url = link.state === 'ready' ? link.url : ''
  const select = () => field.current?.select()

  const doCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(url)
      setCopy('copied')
    } catch {
      select()
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {
        /* fall through to manual */
      }
      setCopy(ok ? 'copied' : 'manual')
    }
  }

  return (
    <div className="scrim" onKeyDown={onKeyDown}>
      <div ref={ref} className="island dialog share" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>Share this model</h2>
        <p>Anyone with the link can open the model as you see it now. Nothing is uploaded.</p>
        {link.state === 'failed' ? (
          <p role="alert">Couldn't make a link for this model.</p>
        ) : (
          <input
            ref={field}
            className="share-field mono"
            type="text"
            readOnly
            aria-label="Share link"
            value={url}
            placeholder={link.state === 'working' ? 'Making the link…' : ''}
            onFocus={select}
          />
        )}
        {url.length > SHARE_LIMIT && <p className="share-warn" role="status">{LONG_LINK}</p>}
        <p className="share-copied" role="status" aria-live="polite">
          {copy === 'copied' ? 'Copied' : copy === 'manual' ? 'Press Ctrl+C (or ⌘C) to copy.' : ''}
        </p>
        <div className="dialog-actions">
          <button type="button" className="tbtn text" data-autofocus onClick={onClose}>Close</button>
          <button type="button" className="tbtn text primary" onClick={() => void doCopy()} disabled={link.state !== 'ready'}>Copy link</button>
        </div>
      </div>
    </div>
  )
}
