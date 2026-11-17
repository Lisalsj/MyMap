import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { initializeTheme } from './ui/theme'
initializeTheme()
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
