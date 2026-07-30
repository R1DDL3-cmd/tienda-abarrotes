import React, { useState, useEffect } from 'react'
import { actionsFor } from '../keyboard/registry.js'
import { keyLabel } from '../keyboard/keys.js'

// Barra de ayuda contextual fija abajo (estilo POS clásico / Norton Commander).
// NO tiene teclas escritas a mano: se genera del registro filtrando por el
// estado actual y el rol, así que agregar una acción al registro la hace
// aparecer aquí sola.
//
// Se muestra expandida por defecto para que un usuario nuevo pueda operar
// solo leyéndola (criterio de aceptación 5), y se puede colapsar.
const COLLAPSED_KEY = 'helpbar_collapsed'

export default function HelpBar({ state, role, extra }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const acciones = actionsFor({ state, role }).filter(a => a.helpBar && a.keys.length > 0)

  return (
    <div className={`help-bar ${collapsed ? 'help-bar-collapsed' : ''}`}>
      <button
        className="help-bar-toggle"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Mostrar teclas' : 'Ocultar teclas'}
        tabIndex={-1}
      >
        {collapsed ? '▲' : '▼'}
      </button>
      {!collapsed && (
        <div className="help-bar-keys">
          {acciones.map(a => (
            <span key={a.id} className="help-key">
              <kbd>{keyLabel(a.keys[0])}</kbd>
              <span className="help-key-name">{a.nombre}</span>
            </span>
          ))}
          {extra}
        </div>
      )}
      {collapsed && <span className="help-bar-hint">Teclas ocultas — F1 muestra la lista completa</span>}
    </div>
  )
}
