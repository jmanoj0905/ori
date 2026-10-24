// The end of a lesson (spec 06 UI): steps done, steps skipped and the time
// taken, with "Fold it again" (the same lesson from a blank sheet) and "Free
// fold from here" (leave lesson mode, keeping the model).
import { useStudio } from '../studio/store'
import { duration, type LessonProgress } from './lessonSlice'
import type { Lesson } from './schema'

export function LessonSummary({ lesson, progress }: { lesson: Lesson; progress: LessonProgress }) {
  const skipped = progress.skipped.length
  const done = lesson.steps.length - skipped
  const time = duration((progress.finishedAt ?? progress.startedAt) - progress.startedAt)
  return (
    <div className="lesson-summary" role="group" aria-label="Lesson summary">
      <p className="lesson-done">
        <span className="ink-check" aria-hidden="true">✓</span> {lesson.title}, folded.
      </p>
      <dl className="lesson-stats">
        <div><dt>Steps done</dt><dd className="mono">{done}</dd></div>
        <div><dt>Skipped</dt><dd className="mono">{skipped}</dd></div>
        <div><dt>Time</dt><dd className="mono">{time}</dd></div>
      </dl>
      <div className="lesson-actions">
        <button type="button" className="tbtn text primary" onClick={() => void useStudio.getState().startLesson(lesson.id)}>
          Fold it again
        </button>
        <button type="button" className="tbtn text" onClick={() => useStudio.getState().exitLesson()}>
          Free fold from here
        </button>
      </div>
    </div>
  )
}
