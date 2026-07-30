// Ventas suspendidas (F6 guarda / F7 retoma).
//
// El caso real: el cliente olvidó algo y va por ello, o pide que le cobres al
// de atrás mientras decide. En vez de perder el ticket, se guarda completo y
// se recupera tal cual. Vive en localStorage —igual que la cola offline— para
// que sobreviva a un cierre accidental del programa o a un corte de luz
// (principio 9: nunca perder trabajo).

const KEY = 'suspended_sales'
const MAX = 20

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))) } catch (e) {}
}

export function listSuspended() {
  return read()
}

export function countSuspended() {
  return read().length
}

// Guarda el ticket actual. Devuelve el id asignado.
export function suspendSale({ cart, totalDiscount, customer, userName }) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : `susp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const total = cart.reduce((s, i) => s + (i.unit_price * i.quantity) - (i.discount || 0), 0) - (totalDiscount || 0)
  const list = read()
  list.unshift({
    id,
    createdAt: new Date().toISOString(),
    userName: userName || '',
    customer: customer || null,
    totalDiscount: totalDiscount || 0,
    total,
    itemCount: cart.length,
    cart,
  })
  write(list)
  return id
}

// Recupera y elimina de la lista (retomar es un movimiento, no una copia).
export function resumeSale(id) {
  const list = read()
  const idx = list.findIndex(s => s.id === id)
  if (idx === -1) return null
  const [found] = list.splice(idx, 1)
  write(list)
  return found
}

export function discardSuspended(id) {
  write(read().filter(s => s.id !== id))
}
