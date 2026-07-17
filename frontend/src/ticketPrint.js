// Estilos y encabezado compartidos entre el ticket de venta (POS.jsx) y el
// pedido a proveedor (Purchases.jsx) — ambos imprimen en el mismo formato
// térmico de 58mm vía window.open()+window.print(). Se centraliza aquí para
// no mantener el CSS y el logo duplicados en dos archivos.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const TICKET_STYLE = `
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 58mm; margin: 0; padding: 6px; line-height: 1.55; }
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
  @media print { body { width: 58mm; } }
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
export function openTicketWindow({ title, bodyHtml }) {
  const win = window.open('', '_blank', 'width=380,height=600')
  if (!win) return null
  win.document.write(`
    <html><head><title>${escapeHtml(title)}</title>
    <style>${TICKET_STYLE}</style></head><body>
    ${bodyHtml}
    <script>window.print()</script>
    </body></html>
  `)
  win.document.close()
  return win
}
