import React, { useEffect, useState } from 'react'
import { settings as settingsApi } from '../api'

// Se monta una sola vez en App.jsx (no en cada página) para que la marca de
// agua aparezca en toda la app sin tocar POS/Inventario/Contabilidad/etc.
// individualmente. Fijo detrás del contenido (z-index bajo) y con opacidad
// baja para no estorbar la lectura — ver .logo-watermark en app.css.
export default function LogoWatermark() {
  const [logo, setLogo] = useState('')

  useEffect(() => {
    settingsApi.getStore().then(s => setLogo(s.store_logo || '')).catch(() => {})
    // Settings.jsx dispara este evento tras guardar, así la marca de agua se
    // actualiza al momento sin recargar la app (App.jsx monta esto una sola vez).
    const onUpdate = (e) => setLogo(e.detail?.store_logo || '')
    window.addEventListener('store-updated', onUpdate)
    return () => window.removeEventListener('store-updated', onUpdate)
  }, [])

  if (!logo) return null

  return (
    <div className="logo-watermark" aria-hidden="true">
      <img src={logo} alt="" />
    </div>
  )
}
