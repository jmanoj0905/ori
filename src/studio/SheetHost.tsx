// Mounts the settings sheet or the shortcut sheet on demand. Both are
// lazy chunks (R31): none of their code or CSS is in the main bundle.
//
// A failed chunk load (offline, a deploy replaced the file) must not take the
// app down: an error boundary closes the sheet, announces it and shows the
// notice toast, and the
// loader is rebuilt (React.lazy caches a rejection) so the next open retries
// with a fresh import().
import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react'
import type { ShortcutSheet as ShortcutSheetType } from './ShortcutSheet'
import type { SettingsSheet as SettingsSheetType } from './SettingsSheet'
import { announce } from './announce'
import { notify } from '../persistence/notice'
import { useUi, type Sheet } from './ui'

type Loader<P> = () => Promise<{ default: ComponentType<P> }>

class SheetBoundary extends Component<
  { resetKey: unknown; onError(): void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  componentDidUpdate(prev: { resetKey: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const LABEL: Record<Sheet, string> = { settings: 'settings', shortcuts: 'the shortcut sheet' }

export function makeSheetHost(
  loadSettings: Loader<{ onClose(): void }>,
  loadShortcuts: Loader<{ onClose(): void; onSettings?: () => void }>,
) {
  let Settings = lazy(loadSettings)
  let Shortcuts = lazy(loadShortcuts)
  const failed = (sheet: Sheet) => {
    if (sheet === 'settings') Settings = lazy(loadSettings)
    else Shortcuts = lazy(loadShortcuts)
    useUi.getState().close()
    const message = `Couldn't open ${LABEL[sheet]}. Check your connection and try again.`
    announce(message)
    notify(message) // visible too, not only to screen readers
  }
  return function SheetHost() {
    const sheet = useUi(s => s.sheet)
    const close = useUi(s => s.close)
    const open = useUi(s => s.open)
    return (
      <SheetBoundary resetKey={sheet} onError={() => sheet && failed(sheet)}>
        <Suspense fallback={null}>
          {sheet === 'settings' && <Settings onClose={close} />}
          {sheet === 'shortcuts' && <Shortcuts onClose={close} onSettings={() => open('settings')} />}
        </Suspense>
      </SheetBoundary>
    )
  }
}

export const SheetHost = makeSheetHost(
  () => import('./SettingsSheet').then(m => ({ default: m.SettingsSheet satisfies typeof SettingsSheetType })),
  () => import('./ShortcutSheet').then(m => ({ default: m.ShortcutSheet satisfies typeof ShortcutSheetType })),
)
