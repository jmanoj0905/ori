import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './studio/tokens.css'
import { App } from './studio/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
