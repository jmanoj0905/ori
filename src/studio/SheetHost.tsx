// Mounts the settings sheet or the shortcut sheet on demand. Both are
// lazy chunks (R31): none of their code or CSS is in the main bundle.
import { Suspense, lazy } from 'react'
import { useUi } from './ui'

const SettingsSheet = lazy(() => import('../settings/SettingsSheet').then(m => ({ default: m.SettingsSheet })))
const ShortcutSheet = lazy(() => import('./ShortcutSheet').then(m => ({ default: m.ShortcutSheet })))

export function SheetHost() {
  const sheet = useUi(s => s.sheet)
  const close = useUi(s => s.close)
  const open = useUi(s => s.open)
  return (
    <Suspense fallback={null}>
      {sheet === 'settings' && <SettingsSheet onClose={close} />}
      {sheet === 'shortcuts' && <ShortcutSheet onClose={close} onSettings={() => open('settings')} />}
    </Suspense>
  )
}
