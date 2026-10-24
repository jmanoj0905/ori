// The flat-foldability issues list (spec 07 "a list shows all problems"):
// every failing interior vertex with its position (mono) and what fails. The
// same issues are drawn on the vertices in the editor, with tooltips.
import type { VertexIssue } from './checks'

const fmt = (x: number) => x.toFixed(4)

export function IssuesPanel({ issues, checking }: { issues: VertexIssue[]; checking: boolean }) {
  return (
    <section className="island designer-issues" aria-label="Flat-foldability">
      <h2 className="issues-title">
        {issues.length === 0 ? (checking ? 'Checking…' : 'Kawasaki and Maekawa hold at every vertex.') : `${issues.length} vertex ${issues.length === 1 ? 'issue' : 'issues'}`}
      </h2>
      {issues.length > 0 && (
        <ul className="issues-list">
          {issues.map(i => (
            <li key={i.vertex}>
              <span className="mono">
                v{i.vertex} ({fmt(i.at[0])}, {fmt(i.at[1])})
              </span>{' '}
              {i.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
