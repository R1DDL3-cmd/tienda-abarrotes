import React from 'react'
import { actionsFor } from '../keyboard/registry.js'
import { keyLabel } from '../keyboard/keys.js'

// Hoja de ayuda completa (F1). Se genera del registro filtrando por el estado
// y el rol: agregar una acción al registro la hace aparecer aquí sola, con su
// tecla real (la del usuario si la personalizó).
export default function KeyHelpSheet({ state, role, titulo, onClose }) {
  const grupos = actionsFor({ state, role }).reduce((acc, a) => {
    const g = a.group || 'Otros'
    acc[g] = acc[g] || []
    acc[g].push(a)
    return acc
  }, {})

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <h3>{titulo || 'Teclas disponibles aquí'}</h3>
        {Object.entries(grupos).map(([grupo, acciones]) => (
          <div className="help-sheet-group" key={grupo}>
            <h4>{grupo}</h4>
            {acciones.map(a => (
              <div className="help-sheet-row" key={a.id}>
                <span>{a.nombre}</span>
                <span className="keys">
                  {a.keys.length
                    ? a.keys.map(k => <kbd key={k}>{keyLabel(k)}</kbd>)
                    : <span className="palette-nokey">sin tecla · búscala en la paleta (F10)</span>}
                </span>
              </div>
            ))}
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
