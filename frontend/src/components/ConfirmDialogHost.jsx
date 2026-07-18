import React, { useEffect, useState } from 'react'
import { _setListener } from '../confirmDialog'
import { modalKeys } from '../modalKeys'

// Montado una sola vez en App.jsx (como LogoWatermark) para que confirmDialog()
// funcione desde cualquier componente sin que cada uno tenga que montar su
// propio modal de confirmación.
export default function ConfirmDialogHost() {
  const [request, setRequest] = useState(null)

  useEffect(() => {
    _setListener((req) => setRequest(req))
    return () => _setListener(null)
  }, [])

  if (!request) return null

  const resolve = (result) => {
    request.resolve(result)
    setRequest(null)
  }

  return (
    <div className="modal-overlay" onClick={() => resolve(false)} onKeyDown={modalKeys(() => resolve(false), () => resolve(true))}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{request.message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => resolve(false)} autoFocus>Cancelar</button>
          <button className="btn btn-primary" onClick={() => resolve(true)}>Aceptar</button>
        </div>
      </div>
    </div>
  )
}
