// Lesson mode's right island (spec 06 UI): it takes the steps island's place
// and shows the lesson outline — done (✓, or "skipped"), current and upcoming
// steps — with the current caption, the last check's message, the hint (from
// the 2nd miss), Show me / Skip step / Exit lesson, the "turn over anyway?"
// question, and at the end the summary. Done steps are buttons: choosing one
// rewinds the lesson to it (lessonJump). Loaded on demand (App, lazy).
import { useEffect, useRef } from 'react'
import { useStudio } from '../studio/store'
import { ConfirmDialog } from '../studio/islands/ConfirmDialog'
import { HINT_AFTER, TURN_CONFIRM } from './lessonSlice'
import { LessonSummary } from './LessonSummary'

export default function LessonOutline() {
  const progress = useStudio(s => s.lesson)
  const lesson = useStudio(s => s.lessonData)
  const pending = useStudio(s => s.pending)
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [progress?.index])
  if (!progress || !lesson) return null
  const { index, misses, skipped, message, finishedAt } = progress
  const done = finishedAt !== null
  const step = lesson.steps[index]
  const st = useStudio.getState
  return (
    <section className="island steps lesson" aria-label="Lesson">
      <header className="lesson-head">
        <h2 className="lesson-title">{lesson.title}</h2>
        <span className="mono lesson-count">{Math.min(index + 1, lesson.steps.length)} / {lesson.steps.length}</span>
      </header>
      {done ? (
        <LessonSummary lesson={lesson} progress={progress} />
      ) : (
        step && (
          <div className="lesson-now">
            <p className="lesson-caption">{step.caption}</p>
            {message && (
              <p className={`lesson-msg ${message.kind}`}>
                {message.kind === 'success' && <span className="ink-check" aria-hidden="true">✓ </span>}
                {message.kind === 'miss' ? message.text.replace(/ Hint: .*$/, '') : message.text}
              </p>
            )}
            {misses >= HINT_AFTER && (
              <p className="lesson-hint">
                <span className="group-label">Hint</span> <span>{step.hint}</span>
              </p>
            )}
            <div className="lesson-actions">
              <button type="button" className="tbtn text primary" disabled={pending || progress.showing} onClick={() => void st().showMe()}>
                Show me
              </button>
              <button type="button" className="tbtn text" disabled={pending} onClick={() => st().skipStep()}>
                Skip step
              </button>
            </div>
          </div>
        )
      )}
      <ol className="step-list" aria-label="Lesson steps">
        {lesson.steps.map((s, i) => {
          const isDone = i < index
          const wasSkipped = skipped.includes(i)
          const isCurrent = i === index && !done
          return (
            <li key={i}>
              <button
                type="button"
                className="step-item"
                data-state={isDone ? (wasSkipped ? 'skipped' : 'done') : isCurrent ? 'current' : 'upcoming'}
                aria-current={isCurrent ? 'step' : undefined}
                ref={isCurrent ? currentRef : undefined}
                disabled={i > index || pending}
                onClick={() => st().lessonJump(i)}
              >
                <span className="mono">{i + 1}</span> · {s.caption}
                {isDone && <span className="sr-only">{wasSkipped ? ' (skipped)' : ' (done)'}</span>}
                {isDone && <span className="step-mark" aria-hidden="true">{wasSkipped ? 'skipped' : '✓'}</span>}
              </button>
            </li>
          )
        })}
      </ol>
      <button type="button" className="tbtn text" onClick={() => st().exitLesson()}>
        Exit lesson
      </button>
      {progress.askTurn && (
        <ConfirmDialog
          title="Turn over?"
          message={TURN_CONFIRM}
          confirmLabel="Turn over"
          onCancel={() => void st().confirmTurn(false)}
          onConfirm={() => void st().confirmTurn(true)}
        />
      )}
    </section>
  )
}
