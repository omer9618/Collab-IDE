/**
 * @fileoverview Application Entry Point (main.jsx).
 *
 * Bootstraps the React virtual DOM tree into the root HTML container with StrictMode enabled.
 *
 * @module main
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
