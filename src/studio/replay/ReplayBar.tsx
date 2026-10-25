// The replay bar (spec 05 "Replay"; R61): play / pause, a scrub slider, speed,
// auto-frame and exit, in place of the fold bar while the studio is in replay
// mode. Lazy-loaded with the Player (R58). The Player replays the history the
// store holds when the bar mounts (up to its cursor) and draws on the Stage;
// the store ignores edits meanwhile, and leaving replay (Exit or Esc) lets
// syncStage redraw the current history frame.
//
// A11y: a labelled region; the play button's name follows its action (Play /
// Pause); the slider reads "Step N of M" and its arrow keys move whole steps
// (Home / End: start / end), while a pointer scrubs continuously; speed is a
// group of pressed buttons. Focus lands on the play button on entry.
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../settings/store'
import { inModal, isTypingTarget } from '../../input/router'
import { prefersReducedMotion } from '../motion'
import { useStudio } from '../store'
import { useUi } from '../ui'
import { Player, SPEEDS, type ReplayView, type Speed } from './Player'
import { drawView, type ReplayStage } from './draw'

export type ReplayBarProps = { stage: ReplayStage; onExit: () => void }

const reduced = () => prefersReducedMotion(useSettings.getState().reducedMotion)

export function ReplayBar({ stage, onExit }: ReplayBarProps) {
  const [player, setPlayer] = useState<Player | null>(null)
  const [view, setView] = useState<ReplayView | null>(null)
  const playRef = useRef<HTMLButtonElement>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  const playerRef = useRef<Player | null>(null)
  /** Stop drawing first, so no stale replay frame can land after syncStage restores the model. */
  const exit = useRef(() => {
    playerRef.current?.dispose()
    exitRef.current()
  }).current

  useEffect(() => {
    const p = new Player(useStudio.getState().history, { reduced })
    const draw = drawView(stage, () => !reduced())
    p.onFrame(v => {
      draw(v)
      setView(v)
    })
    playerRef.current = p
    setPlayer(p)
    p.seek(0)
    p.play()
    return () => {
      p.dispose()
      if (playerRef.current === p) playerRef.current = null
    }
  }, [stage])

  useEffect(() => {
    if (player) playRef.current?.focus()
  }, [player])

  // Esc leaves replay (unless a dialog or sheet has it, or the user is typing). The router's
  // own Esc (cancel) may have prevented the default already: that is not a reason to stay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isTypingTarget(e.target) || inModal(e.target) || useUi.getState().sheet) return
      exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit])

  if (!player || !view) return null
  const { steps, playing } = view
  const t = view.t

  const onSliderKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const to = (() => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          return Math.min(steps, Math.floor(t + 1e-9) + 1)
        case 'ArrowLeft':
        case 'ArrowDown':
          return Math.max(0, Math.ceil(t - 1e-9) - 1)
        case 'Home':
          return 0
        case 'End':
          return steps
        default:
          return null
      }
    })()
    if (to === null) return
    e.preventDefault()
    player.seek(to)
  }

  return (
    <section className="island replaybar" aria-label="Replay">
      <button
        ref={playRef}
        type="button"
        className="tbtn text primary"
        onClick={() => (playing ? player.pause() : player.play())}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <label className="scrub">
        <span className="sr-only">Replay position</span>
        <input
          type="range"
          min={0}
          max={steps}
          step={reduced() ? 1 : 0.01}
          value={t}
          aria-valuetext={`Step ${view.step} of ${steps}`}
          onKeyDown={onSliderKey}
          onChange={e => player.seek(Number(e.target.value))}
        />
        <output className="mono" aria-hidden="true">{view.step} / {steps}</output>
      </label>
      <div role="group" aria-label="Speed" className="seg">
        {SPEEDS.map((s: Speed) => (
          <button key={s} type="button" aria-pressed={player.speed === s} onClick={() => player.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <label className="autoframe">
        <input type="checkbox" checked={view.autoFrame} onChange={e => (player.autoFrame = e.target.checked)} />
        Auto-frame camera
      </label>
      <button type="button" className="tbtn text" onClick={exit} title="Exit replay (Esc)">
        Exit replay
      </button>
    </section>
  )
}

export default ReplayBar
