// The paper's look (spec 02 materials, spec 03 paper panel): plain types,
// constants and validation shared by the studio, the renderer, the settings
// and autosave. A dependency-free leaf: it imports nothing, so any module may
// depend on it without crossing a boundary (spec 00 module table).

export const SWATCHES = Object.freeze({
  vermilion: '#D9472B',
  indigo: '#2F4A8A',
  matcha: '#7A9A57',
  ochre: '#C9962B',
  sumi: '#2B2A28',
})

export type SheetSize = 'square' | 'a4' | { width: number; height: number }

export type PaperSettings = {
  mode: 'kami' | 'washi' | 'plain' | 'custom'
  front: string
  back: string
  pattern?: 'seigaiha' | 'asanoha'
  thickness: number
  translucency: number
  size: SheetSize
}

export const DEFAULT_PAPER: PaperSettings = Object.freeze({
  mode: 'kami',
  front: SWATCHES.vermilion,
  back: '#FFFFFF',
  thickness: 0.5,
  translucency: 0,
  size: 'square',
})

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const HEX = /^#[0-9a-f]{6}$/i
const MODES = ['kami', 'washi', 'plain', 'custom'] as const
const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d)
const dim = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000

/**
 * Any value -> a valid PaperSettings: each field is checked on its own and
 * falls back to DEFAULT_PAPER's (colours must be #rrggbb, thickness and
 * translucency are clamped to [0, 1], a custom size to (0, 1000]).
 */
export function cleanPaper(raw: unknown): PaperSettings {
  const d = DEFAULT_PAPER
  if (!isObj(raw)) return { ...d }
  const size = raw.size
  const out: PaperSettings = {
    mode: MODES.find(m => m === raw.mode) ?? d.mode,
    front: typeof raw.front === 'string' && HEX.test(raw.front) ? raw.front : d.front,
    back: typeof raw.back === 'string' && HEX.test(raw.back) ? raw.back : d.back,
    thickness: unit(raw.thickness, d.thickness),
    translucency: unit(raw.translucency, d.translucency),
    size:
      size === 'square' || size === 'a4' ? size
      : isObj(size) && dim(size.width) && dim(size.height) ? { width: size.width, height: size.height }
      : d.size,
  }
  if (raw.pattern === 'seigaiha' || raw.pattern === 'asanoha') out.pattern = raw.pattern
  return out
}
