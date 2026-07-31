import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyStoredAppearance } from './theme'

// Tema y estética ANTES del primer render: si se aplicaran dentro de un
// efecto, la app se vería un instante con la apariencia equivocada en cada
// arranque.
applyStoredAppearance()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
