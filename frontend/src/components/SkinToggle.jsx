import React, { useState } from 'react'
import { getSkin, toggleSkin, SKINS } from '../theme'

// Interruptor de estética: clásico empresarial ⇄ moderno.
//
// El cambio es instantáneo porque no re-renderiza nada: solo cambia el
// atributo data-skin de <html> y el navegador recalcula estilos. La etiqueta
// muestra a DÓNDE se va, no dónde se está, que es lo que el usuario quiere
// saber antes de pulsar.
export default function SkinToggle({ className = 'btn btn-sm btn-outline' }) {
  const [skin, setSkinState] = useState(getSkin())
  const esClasico = skin === SKINS.ENTERPRISE

  return (
    <button
      className={className}
      onClick={() => setSkinState(toggleSkin())}
      title={esClasico
        ? 'Cambiar a la vista moderna'
        : 'Cambiar a la vista clásica: más densa, más renglones por pantalla, sin adornos'}
    >
      {esClasico ? '◱ Moderno' : '▤ Clásico'}
    </button>
  )
}
