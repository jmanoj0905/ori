/*
 * The lesson recordings: the folds each launch lesson is made of, as the
 * gestures a learner would make in the sandbox (the same data a played
 * session exports through devExport). `author.test.ts` (run with
 * ORI_AUTHOR=1) replays them through the engine, exports the history with
 * `lessonSkeleton` and writes `data/<id>.json`, keeping the hand-written
 * captions, hints, cameras and allowMirror flags already there.
 *
 * Grab and target points are exact model points where possible (a corner, a
 * point on an edge, a crease end): keyboard folding offers a lesson step's
 * demo grab and target as landmarks, so these are what a keyboard learner
 * folds between.
 *
 * Plane, cup and crane fold the presets' models (the cup re-recorded from its
 * exact corner and edge points; the preset drags from just inside them).
 *
 * Waterbomb base (square): fold in half top to bottom, then right to left
 * (a 4-layer square with the closed corner at the paper's centre), squash the
 * front flap open into a triangle, turn over, squash the other flap. The
 * result is the classic waterbomb triangle, apex at the sheet's centre.
 *
 * Jumping frog (an index card, 1 × 5/3): the head is a waterbomb collapse of
 * the top square, made as: fold the top edge down to the square's foot
 * (y = 2/3, valley, crease at y = 7/6), then inside reverse fold each top
 * corner along the square's diagonal, which tucks the side triangles in
 * between the layers and leaves the triangle with its apex at the square's
 * centre. Then the front legs (each base corner's top two layers up to the
 * apex), fold the bottom edge up to the head, fold that flap back down
 * (the spring), and turn over.
 * Deviations from the classic diagram: the classic pre-creases the X and the
 * horizontal and collapses them at once (not a single gesture here), so its
 * side triangles end up as the front flaps, where here they are tucked
 * inside and the front legs are folded from the front layer and the tucked
 * flap's top layer. The classic also folds the body's sides to the centre
 * before the spring; that fold would have to run under the legs and is left
 * out.
 */
import type { Gesture, Vec2 } from '@engine'
import { PRESETS } from '../../presets'
import { TURN_OVER, along, gesture } from '../../presets/gestures'
import type { PresetStep } from '../../presets'
import type { LessonMeta } from '../devExport'

export type Recording = LessonMeta & { steps: PresetStep[] }

const preset = (id: 'plane' | 'cup' | 'crane') => PRESETS.find(p => p.id === id)!.steps

const h = 2 - Math.SQRT2
const fold = (grab: Vec2, target: Vec2, layers: number, kind: Gesture['kind'] = 'valley') => gesture('fold', grab, target, layers, kind)

const H = 5 / 3 // the card's height
const foot = 2 / 3 // the head square's lower edge
const apex: Vec2 = [0.5, 7 / 6] // the head square's centre

export const RECORDINGS: Recording[] = [
  {
    id: 'waterbomb',
    title: 'Waterbomb base',
    difficulty: 1,
    paper: 'square',
    material: { mode: 'kami', front: '#C9962B', back: '#FFFFFF' },
    steps: [
      fold([0.5, 1], [0.5, 0], 1),
      fold([1, 0.25], [0, 0.25], 2),
      gesture('squash', [0.4, 0.4], [0.1, 0.1], 1),
      TURN_OVER,
      gesture('squash', [0.6, 0.4], [0.9, 0.1], 1),
    ],
  },
  {
    id: 'plane',
    title: 'Paper plane',
    difficulty: 1,
    paper: 'a4',
    material: { mode: 'plain', front: '#FFFFFF', back: '#FFFFFF' },
    steps: preset('plane'),
  },
  {
    id: 'cup',
    title: 'Cup',
    difficulty: 1,
    paper: 'square',
    material: { mode: 'kami', front: '#2F4A8A', back: '#FFFFFF' },
    steps: [
      fold([0, 0], [1, 1], 1),
      fold([1, 0], [h, 1], 2),
      fold([0, 1], [1, h], 2),
      fold([1, 1], [h, h], 1),
      TURN_OVER,
      fold([Math.SQRT2 - 1, 1], [2 * Math.SQRT2 - 2, h], 1),
    ],
  },
  {
    id: 'frog',
    title: 'Jumping frog',
    difficulty: 2,
    paper: { width: 1, height: H },
    material: { mode: 'kami', front: '#7A9A57', back: '#FFFFFF' },
    steps: [
      fold([0.5, H], [0.5, foot], 1),
      // grabbed just inside each corner: the corner vertex itself touches the reversed flap's neighbours
      along('reverse', [0.05, 7 / 6 - 0.02], [0, foot], [1, 1], 2),
      along('reverse', [0.95, 7 / 6 - 0.02], [1, foot], [-1, 1], 2),
      fold([0, foot], apex, 2),
      fold([1, foot], apex, 2),
      fold([0.5, 0], [0.5, foot], 1),
      fold([0.5, 0.63], [0.5, 0.37], 1),
      TURN_OVER,
    ],
  },
  {
    id: 'crane',
    title: 'Crane',
    difficulty: 3,
    paper: 'square',
    material: { mode: 'washi', front: '#D9472B', back: '#FFFFFF' },
    steps: preset('crane'),
  },
]
