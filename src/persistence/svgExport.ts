// Crease-pattern SVG in Yoshizawa–Randlett diagram style (spec 05 "File export").
// A standalone SVG: xmlns, a viewBox, and width/height in px equal to the
// viewBox size (user units are px; the longest side of the paper is
// PAPER_PX units, so the 6 4 / 6 3 1.5 3 dashes read at diagram scale).
// Styles: 'diagram' draws everything in one ink (mountain/valley told apart by
// dash only); 'mv-color' uses the conventional red mountains and blue valleys
// AND keeps the dashes, so the pattern never relies on colour alone.
import type { Frame } from '@engine'
import { DASH, creasePatternLayout, type CpKind } from './creasePattern'

export type SvgStyle = 'diagram' | 'mv-color'
export type SvgOptions = {
  /** Draw an n × n grid over the paper (n divisions each way); omitted or < 2: none. */
  grid?: number
  style: SvgStyle
}

const PAPER_PX = 400
const INK = '#26231f'
const COLOR: Record<SvgStyle, Record<CpKind, string>> = {
  diagram: { boundary: INK, valley: INK, mountain: INK },
  'mv-color': { boundary: INK, valley: '#1f5fbf', mountain: '#c0392b' },
}
const WIDTH: Record<CpKind, number> = { boundary: 2, valley: 1.4, mountain: 1.4 }

const num = (n: number): string => String(Math.round(n * 1000) / 1000)

export function toCreasePatternSvg(frame: Frame, opts: SvgOptions): string {
  // Scale so the paper's longer side is PAPER_PX units.
  const unit = creasePatternLayout(frame, 1).paper
  const scale = PAPER_PX / (Math.max(unit.width, unit.height) || 1)
  const { width, height, paper, segments } = creasePatternLayout(frame, scale)
  const colors = COLOR[opts.style]
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}px" height="${num(height)}px" viewBox="0 0 ${num(width)} ${num(height)}">`,
    '<title>Crease pattern</title>',
    `<rect width="${num(width)}" height="${num(height)}" fill="#ffffff"/>`,
  ]
  const n = Math.floor(opts.grid ?? 0)
  if (n >= 2) {
    const g: string[] = []
    for (let i = 1; i < n; i++) {
      const x = paper.x + (paper.width * i) / n
      const y = paper.y + (paper.height * i) / n
      g.push(`<line class="cp-grid-line" x1="${num(x)}" y1="${num(paper.y)}" x2="${num(x)}" y2="${num(paper.y + paper.height)}"/>`)
      g.push(`<line class="cp-grid-line" x1="${num(paper.x)}" y1="${num(y)}" x2="${num(paper.x + paper.width)}" y2="${num(y)}"/>`)
    }
    out.push(`<g class="cp-grid" stroke="#b9b3a8" stroke-width="0.6" fill="none">${g.join('')}</g>`)
  }
  for (const kind of ['valley', 'mountain'] as const) {
    const dash = DASH[kind]
    for (const s of segments.filter(s => s.kind === kind)) {
      out.push(
        `<line class="cp-${kind}" x1="${num(s.x1)}" y1="${num(s.y1)}" x2="${num(s.x2)}" y2="${num(s.y2)}" stroke="${colors[kind]}" stroke-width="${WIDTH[kind]}" stroke-dasharray="${dash}" stroke-linecap="round"/>`,
      )
    }
  }
  const b = segments.filter(s => s.kind === 'boundary')
  if (b.length) {
    const d = b.map(s => `M${num(s.x1)} ${num(s.y1)}L${num(s.x2)} ${num(s.y2)}`).join('')
    out.push(`<path class="cp-boundary" d="${d}" fill="none" stroke="${colors.boundary}" stroke-width="${WIDTH.boundary}" stroke-linecap="round" stroke-linejoin="round"/>`)
  }
  out.push('</svg>')
  return out.join('\n') + '\n'
}
