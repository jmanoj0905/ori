// The last line of defence: an error thrown while rendering anything in the
// app shows one calm full-page message (with a reload) instead of a blank page.
import { Component, type ReactNode } from 'react'

export const APP_FAILED = 'Something went wrong. Reload to try again.'

export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('Ori stopped:', err)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="app-failed" role="alert">
        <p>{APP_FAILED}</p>
        <button type="button" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
