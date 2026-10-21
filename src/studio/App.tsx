// The studio shell: a full-bleed ivory canvas hosting the Stage, with the
// wordmark island and the hint line. Later tasks add the Stage and islands.
import './App.css'
import { useStudio } from './store'

export function App() {
  const hint = useStudio(s => s.hint)
  const refusal = useStudio(s => s.refusal)
  return (
    <main className="studio">
      <div className="stage-host" data-stage-host />
      <header className="island topbar">
        <h1 className="wordmark">ori · 折り</h1>
      </header>
      <p className="hint" role="status" aria-live="polite" data-refusal={refusal ? '' : undefined}>
        {refusal ?? hint}
      </p>
    </main>
  )
}
