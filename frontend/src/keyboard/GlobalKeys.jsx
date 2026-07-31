import React, { useEffect, useState } from 'react'
import { resolveKey, searchActions, STATES } from './registry.js'
import { eventToKeyString, isTypingKey, keyLabel } from './keys.js'
import CommandPalette from '../components/CommandPalette'

// TECLAS GLOBALES — la red de seguridad de toda la app.
//
// Cada sección monta su propia capa (useKeyboardLayer) y atiende lo suyo en
// fase de captura, marcando el evento con preventDefault. Este componente
// escucha DESPUÉS, en fase de burbuja, y solo actúa sobre lo que nadie tomó:
// así la navegación entre secciones, la paleta y la ayuda siguen funcionando
// en pantallas que aún no tienen capa propia y, sobre todo, con cualquier
// recuadro abierto encima.
//
// Se consulta el registro con el estado MODAL —el más restrictivo— porque en
// él solo resuelven las acciones marcadas como globales.
export default function GlobalKeys({ role }) {
  const [showPalette, setShowPalette] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const onKeyDown = (e) => {
      // Ya lo atendió la sección: no se ejecuta dos veces.
      if (e.defaultPrevented) return
      if (isTypingKey(e)) return

      const keyString = eventToKeyString(e)
      if (!keyString) return

      if (keyString === 'Escape') {
        if (showPalette) { e.preventDefault(); setShowPalette(false) }
        else if (showHelp) { e.preventDefault(); setShowHelp(false) }
        return
      }

      const action = resolveKey(keyString, { state: STATES.MODAL, role })
      if (!action) return

      e.preventDefault()
      if (action.hash) { window.location.hash = action.hash; return }
      if (action.id === 'sys_palette') setShowPalette(true)
      if (action.id === 'sys_help') setShowHelp(true)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [role, showPalette, showHelp])

  const globales = searchActions('', { state: STATES.MODAL, role })

  return (
    <>
      {showPalette && (
        <CommandPalette
          state={STATES.MODAL}
          role={role}
          onRun={(action) => {
            setShowPalette(false)
            if (action.hash) window.location.hash = action.hash
          }}
          onClose={() => setShowPalette(false)}
        />
      )}
      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Teclas disponibles en cualquier pantalla</h3>
            <div className="help-sheet-group">
              {globales.filter(a => a.keys.length).map(a => (
                <div className="help-sheet-row" key={a.id}>
                  <span>{a.nombre}</span>
                  <span className="keys">{a.keys.map(k => <kbd key={k}>{keyLabel(k)}</kbd>)}</span>
                </div>
              ))}
            </div>
            <p className="text-muted">Cada sección añade las suyas: pulsa F1 dentro de ella.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowHelp(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
