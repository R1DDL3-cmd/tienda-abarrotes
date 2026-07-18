// Estilos y encabezado compartidos entre el ticket de venta (POS.jsx) y el
// pedido a proveedor (Purchases.jsx) — ambos imprimen en el mismo formato
// térmico de 58mm vía window.open()+window.print(). Se centraliza aquí para
// no mantener el CSS y el logo duplicados en dos archivos.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// El rollo térmico es de 58mm, pero el área que el cabezal de impresión
// realmente alcanza a imprimir en la inmensa mayoría de esas impresoras es de
// ~48mm (el resto es margen mecánico de cada lado) — usar los 58mm completos
// como ancho de contenido cortaba el borde derecho del ticket.
const TICKET_WIDTH = '48mm'

const TICKET_STYLE = `
  body { font-family: 'Courier New', monospace; font-size: 12px; width: ${TICKET_WIDTH}; margin: 0; padding: 6px; line-height: 1.55; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 3px 0; overflow-wrap: break-word; word-break: break-word; }
  th { border-bottom: 1px solid #000; font-size: 11px; padding-bottom: 4px; }
  td { vertical-align: top; }
  .product-name { max-width: 0; }
  .center { text-align: center; }
  .right { text-align: right; }
  .line { border-top: 1px dashed #000; margin: 8px 0; }
  .logo { display: block; max-width: 72px; max-height: 72px; margin: 0 auto 6px auto; object-fit: contain; }
  h3 { margin: 4px 0; overflow-wrap: break-word; font-size: 14px; letter-spacing: 0.02em; }
  p { margin: 3px 0; }
  .total-box { border: 1px solid #000; border-radius: 3px; padding: 6px 8px; margin-top: 8px; }
  .total-box .total-amount { font-size: 16px; margin: 2px 0; }
  .ticket-actions { display: flex; gap: 8px; margin-bottom: 10px; }
  .ticket-actions button { flex: 1; font-family: inherit; font-size: 12px; padding: 8px; border: 1px solid #000; background: #fff; cursor: pointer; }
  @media print {
    body { width: ${TICKET_WIDTH}; }
    .ticket-actions { display: none; }
  }
`

export function buildStoreHeader(storeInfo) {
  return `
    ${storeInfo.store_logo ? `<img class="logo" src="${storeInfo.store_logo}" alt="" />` : ''}
    <h3>${escapeHtml(storeInfo.store_name)}</h3>
    ${storeInfo.store_address ? `<p>${escapeHtml(storeInfo.store_address)}</p>` : ''}
    ${storeInfo.store_phone ? `<p>Tel: ${escapeHtml(storeInfo.store_phone)}</p>` : ''}
  `
}

// Devuelve la ventana abierta, o null si el navegador bloqueó el popup —
// quien llame debe avisarle al usuario en ese caso.
//
// v1.0.3 intentó cerrar esta ventana sola con window.onafterprint apenas se
// cerraba el diálogo de impresión, para resincronizar el foco de la ventana
// principal (ver registerChildWindowFocusFix en electron/main.js) sin
// depender de que alguien la cerrara a mano. En la práctica, 'afterprint' se
// dispara casi de inmediato en este contexto de Electron — MUCHO antes de
// que el usuario alcance siquiera a ver el diálogo de impresión, así que la
// ventana se autodestruía antes de poder imprimir nada. Ahora imprimir y
// cerrar son botones explícitos: más lento un clic, pero confiable. El
// resync de foco sigue disparándose igual cuando la ventana se cierra
// (con el botón o con la X), solo que ahora sucede cuando el usuario
// realmente termina, no antes.
export function openTicketWindow({ title, bodyHtml }) {
  const win = window.open('', '_blank', 'width=380,height=600')
  if (!win) return null
  win.document.write(`
    <html><head><title>${escapeHtml(title)}</title>
    <style>${TICKET_STYLE}</style></head><body>
    <div class="ticket-actions">
      <button onclick="window.print()">Imprimir</button>
      <button onclick="window.close()">Cerrar</button>
    </div>
    ${bodyHtml}
    </body></html>
  `)
  win.document.close()
  return win
}
