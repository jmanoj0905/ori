import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (OFL), the weights the design uses; each file lists every
// subset by unicode-range, so the browser fetches only what the page shows.
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './studio/tokens.css'
import { App } from './studio/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
