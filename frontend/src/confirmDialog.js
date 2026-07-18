// Reemplaza window.confirm() en toda la app. Un diálogo nativo del SO sobre
// la ventana de Electron es exactamente el patrón que rompe el enrutamiento
// de teclado de Chromium (la ventana se ve enfocada pero deja de responder
// hasta minimizar/restaurar) — con 13 usos de confirm() repartidos por la
// app, era la causa más probable del bug reportado, más frecuente que la
// impresión de tickets. confirmDialog() es 100% en-página (sin diálogo
// nativo) y se resuelve como promesa; ConfirmDialogHost.jsx la renderiza.
let listener = null

export function confirmDialog(message) {
  return new Promise((resolve) => {
    if (listener) listener({ message, resolve })
    else resolve(window.confirm(message))
  })
}

export function _setListener(fn) {
  listener = fn
}
