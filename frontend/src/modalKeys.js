// Handler de teclado compartido para los overlays de modal (div.modal-overlay):
// ESC cierra el modal, Enter confirma la acción principal (el mismo handler
// que ya usa el botón primario del modal). Pasa onClose=null para marcar un
// modal como obligatorio (ESC no hace nada) — ej. el conteo de caja al
// cerrar sesión, que es intencionalmente no descartable.
export function modalKeys(onClose, onConfirm) {
  return (e) => {
    if (e.key === 'Escape') {
      if (onClose) {
        e.stopPropagation()
        onClose()
      }
      return
    }
    if (e.key === 'Enter') {
      // En un textarea, Enter debe insertar un salto de línea, no confirmar.
      if (e.target.tagName === 'TEXTAREA') return
      if (onConfirm) {
        e.stopPropagation()
        onConfirm()
      }
    }
  }
}
