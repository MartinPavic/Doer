import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initErrorReporting } from '@doer/core'
import './index.css'
import App from './App.tsx'

void initErrorReporting({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
