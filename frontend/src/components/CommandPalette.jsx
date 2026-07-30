import React, { useState, useEffect, useRef } from 'react'
import { searchActions } from '../keyboard/registry.js'
import { keyLabel } from '../keyboard/keys.js'

// Paleta de comandos: el puente entre "no sé nada" y "no suelto el teclado".
// Escribes 3 letras, ves la acción CON su atajo (así se aprenden solos) y
// Enter la ejecuta. Se alimenta del registro, por lo que cualquier acción
// nueva es alcanzable aquí sin escribir una línea extra.
export default function CommandPalette({ state, role, onRun, onClose }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const results = searchActions(query, { state, role })

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setIndex(0) }, [query])

  // Mantiene visible la opción seleccionada al moverse con las flechas.
  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-item.active')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const action = results[index]
      if (action) onRun(action)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
    // El resto de teclas escriben en el buscador; se detiene la propagación
    // para que la capa global no las interprete como atajos.
    e.stopPropagation()
  }

  return (
    <div className="modal-overlay palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe una acción... (ej. retiro, gasto, corte)"
        />
        <div className="palette-list" ref={listRef}>
          {results.map((a, i) => (
            <div
              key={a.id}
              className={`palette-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onRun(a)}
            >
              <div className="palette-item-main">
                <span className="palette-item-name">{a.nombre}</span>
                <span className="palette-item-desc">{a.descripcion}</span>
              </div>
              <div className="palette-item-keys">
                {a.keys.length > 0
                  ? a.keys.map(k => <kbd key={k}>{keyLabel(k)}</kbd>)
                  : <span className="palette-nokey">sin tecla</span>}
              </div>
            </div>
          ))}
          {results.length === 0 && (
            <div className="palette-empty">Ninguna acción coincide con "{query}"</div>
          )}
        </div>
        <div className="palette-footer">
          <kbd>↑</kbd><kbd>↓</kbd> moverse · <kbd>Enter</kbd> ejecutar · <kbd>Esc</kbd> cerrar
        </div>
      </div>
    </div>
  )
}
