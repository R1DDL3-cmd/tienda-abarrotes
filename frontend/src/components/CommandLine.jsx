import React from 'react'

// LÍNEA DE COMANDO REUTILIZABLE
//
// Es el mismo control del POS, extraído para que Compras (y después
// Inventario) no lo dupliquen. Lo que cambia entre secciones es la gramática,
// así que el parser se inyecta desde fuera: aquí solo vive el comportamiento
// que debe ser idéntico en todas partes.
//
//   · Enter ejecuta lo escrito y deja el campo listo para lo siguiente.
//   · Tab acepta la sugerencia fantasma de /comandos.
//   · El lector de código de barras "teclea" el código y manda un Enter (o un
//     salto de línea dentro del valor): ambos casos se tratan igual, y el
//     aviso "escaneando…" confirma que la ráfaga se está reconociendo.
//
// El foco es responsabilidad de quien lo usa (focusCommandLine), porque solo
// la sección sabe cuándo una operación terminó.
export default function CommandLine({
  inputRef, value, onChange, onSubmit,
  placeholder, suggest, scanning, className = 'input-lg', children,
}) {
  const ghost = suggest ? suggest(value) : null

  const enviar = (texto) => {
    const limpio = String(texto || '').replace(/[\n\r]/g, '').trim()
    onChange('')
    if (limpio) onSubmit(limpio)
  }

  const alEscribir = (e) => {
    const raw = e.target.value
    // El lector puede meter el salto de línea dentro del propio valor en vez
    // de mandar un keydown de Enter (depende del modelo y de la velocidad).
    if (raw.includes('\n') || raw.includes('\r')) enviar(raw)
    else onChange(raw)
  }

  const alPulsar = (e) => {
    if (e.key === 'Tab' && ghost) {
      e.preventDefault()
      onChange(ghost)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      enviar(e.currentTarget.value)
    }
  }

  return (
    <div className="input-group command-line-wrap">
      <input
        ref={inputRef}
        type="text"
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={alEscribir}
        onKeyDown={alPulsar}
        autoFocus
      />
      {/* Sugerencia en gris detrás de lo ya escrito: se aprende el comando
          usándolo, sin tener que consultar la ayuda. */}
      {ghost && (
        <div className="command-ghost"><span className="typed">{value}</span>{ghost.slice(value.length)}</div>
      )}
      {scanning && <span className="scanning-badge">escaneando…</span>}
      {children}
    </div>
  )
}
