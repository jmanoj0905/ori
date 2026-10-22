// The "Replace your current model?" question raised at start-up when a share
// link meets autosaved work (R59). A vanilla store so boot (no React) can ask
// and the OpenPrompt island can answer.
import { createStore } from 'zustand/vanilla'

export const openPrompt = createStore<{ resolve: ((replace: boolean) => void) | null }>(() => ({ resolve: null }))

/** Show the dialog; resolves true for Replace, false for Cancel. */
export function askReplace(): Promise<boolean> {
  return new Promise(resolve => {
    openPrompt.setState({
      resolve: replace => {
        openPrompt.setState({ resolve: null })
        resolve(replace)
      },
    })
  })
}
