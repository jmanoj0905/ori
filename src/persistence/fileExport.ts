// Downloads for the .fold and crease-pattern SVG exports. Loaded on demand
// (dynamic import) so the exporters stay out of the first-load bundle.
import { current, type History } from '@engine'
import { foldExportWarning, toFoldFile } from './foldExport'
import { toCreasePatternSvg, type SvgOptions } from './svgExport'
import { download, exportName } from './png'
import { EXPORT_FAILED, notify } from './notice'

/** Download the current frame + history up to the cursor as `ori-YYYY-MM-DD-<step>.fold`. Never throws. */
export function exportFold(h: History): void {
  try {
    download(new Blob([toFoldFile(h)], { type: 'application/json' }), exportName(new Date(), h.cursor, 'fold'))
    const warning = foldExportWarning(h)
    if (warning) notify(warning)
  } catch {
    notify(EXPORT_FAILED)
  }
}

/** Download the current crease pattern as `ori-YYYY-MM-DD-<step>.svg`. Never throws. */
export function exportSvg(h: History, opts: SvgOptions): void {
  try {
    download(new Blob([toCreasePatternSvg(current(h), opts)], { type: 'image/svg+xml' }), exportName(new Date(), h.cursor, 'svg'))
  } catch {
    notify(EXPORT_FAILED)
  }
}
