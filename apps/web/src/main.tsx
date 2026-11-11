import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { describeFlags } from './flags'

if (import.meta.env.DEV) {
  console.info('[web] flags da Onda 1:', describeFlags())
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
