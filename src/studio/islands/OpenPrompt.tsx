// Asks before a share link replaces the autosaved model (R59 / Review Focus 3).
import { useStore } from 'zustand'
import { REPLACE_MESSAGE, REPLACE_TITLE } from '../../persistence/openFromHash'
import { openPrompt } from '../openPrompt'
import { ConfirmDialog } from './ConfirmDialog'

export function OpenPrompt() {
  const resolve = useStore(openPrompt, s => s.resolve)
  if (!resolve) return null
  return (
    <ConfirmDialog
      title={REPLACE_TITLE}
      message={REPLACE_MESSAGE}
      confirmLabel="Replace"
      onCancel={() => resolve(false)}
      onConfirm={() => resolve(true)}
    />
  )
}
