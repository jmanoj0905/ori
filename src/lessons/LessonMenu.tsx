// The lesson menu (the Steps island's "Lessons" button opens it; loaded on
// demand with the lesson data). It lists the lessons that pass validation:
// a broken lesson file is left out with a console error (Review Focus 4,
// schema.loadLessons), never taking the menu or the app down.
import { useMemo } from 'react'
import { loadLessons } from './schema'

export type LessonMenuProps = {
  onPick(id: string): void
  /** The lesson files to offer (tests); default: the bundled ones. */
  raws?: readonly unknown[]
}

export function LessonMenu({ onPick, raws }: LessonMenuProps) {
  const lessons = useMemo(() => (raws ? loadLessons(raws) : loadLessons()), [raws])
  return (
    <div role="group" aria-label="Lessons" className="presets lesson-menu">
      {lessons.map(l => (
        <button key={l.id} type="button" className="preset-btn lesson-pick" onClick={() => onPick(l.id)}>
          {l.title}
          <span className="difficulty" aria-hidden="true">{'●'.repeat(l.difficulty)}{'○'.repeat(3 - l.difficulty)}</span>
          <span className="sr-only">, difficulty {l.difficulty} of 3</span>
        </button>
      ))}
      {lessons.length === 0 && <p className="lesson-empty">No lessons could be loaded.</p>}
    </div>
  )
}

export default LessonMenu
