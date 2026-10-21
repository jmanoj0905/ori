// The studio shell: a full-bleed ivory canvas hosting the Stage, with the
// wordmark island and the hint line. Later tasks add the Stage and islands.
import './App.css'
import { useEffect, useRef } from 'react'
import type { Stage } from '../render/Stage'
import { useStudio } from './store'

export function App() {
  const hint = useStudio(s => s.hint)
  const refusal = useStudio(s => s.refusal)
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Three.js is loaded lazily so it stays out of the main chunk; a missing
    // WebGL context (e.g. jsdom) must not take the shell down.
    let stage: Stage | undefined
    let cancelled = false
    void import('../render/Stage')
      .then(m => {
        if (!cancelled) stage = new m.Stage(host)
      })
      .catch(err => console.warn('Stage unavailable:', err))
    return () => {
      cancelled = true
      stage?.dispose()
    }
  }, [])
  return (
    <main className="studio">
      <div className="stage-host" data-stage-host ref={hostRef} />
      <header className="island topbar">
        <h1 className="wordmark">ori · 折り</h1>
      </header>
      <p className="hint" role="status" aria-live="polite" data-refusal={refusal ? '' : undefined}>
        {refusal ?? hint}
      </p>
    </main>
  )
}
