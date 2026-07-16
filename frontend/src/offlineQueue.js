// Cola de ventas offline (checkpoint 2 del plan de modo offline). Cuando no
// hay conexión, la venta se guarda aquí en vez de perderse; al recuperar la
// señal se reintenta enviar cada una en el orden en que se hicieron.
//
// Regla de conflictos: el servidor SIEMPRE valida stock/crédito en el
// momento de aplicar la venta (misma lógica que una venta normal, ver
// server/routes/sales.js) — nunca se fuerza un resultado calculado aquí en
// el cliente. Si el servidor la rechaza (ej. ya no hay stock porque otro
// dispositivo vendió lo último mientras ambos estaban desconectados), la
// venta se marca "failed" y queda visible para que el admin la resuelva a
// mano, en vez de reintentarse en bucle o perderse en silencio.

const QUEUE_KEY = 'offline_sales_queue';

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) {}
}

export function getQueue() {
  return readQueue();
}

export function enqueueSale(payload) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const queue = readQueue();
  queue.push({
    id,
    payload,
    status: 'pending',
    error: null,
    createdAt: new Date().toISOString()
  });
  writeQueue(queue);
  return id;
}

export function removeFromQueue(id) {
  writeQueue(readQueue().filter(item => item.id !== id));
}

function updateItem(id, patch) {
  const queue = readQueue();
  const idx = queue.findIndex(item => item.id === id);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx], ...patch };
  writeQueue(queue);
}

// salesCreate: la función sales.create(data) de api.js, inyectada para
// evitar un ciclo de imports entre este módulo y api.js.
export async function syncQueue(salesCreate) {
  const queue = readQueue().filter(item => item.status === 'pending');
  const synced = [];
  for (const item of queue) {
    try {
      const res = await salesCreate({
        ...item.payload,
        client_id: item.id,
        client_created_at: item.createdAt
      });
      removeFromQueue(item.id);
      synced.push({ id: item.id, sale: res.sale });
    } catch (e) {
      if (e.message === 'Failed to fetch') {
        // Seguimos sin conexión — dejar el resto en la cola para el próximo intento.
        break;
      }
      // El servidor la rechazó de verdad (stock, límite de crédito, etc.) —
      // no reintentar sola, que la revise un admin.
      updateItem(item.id, { status: 'failed', error: e.message });
    }
  }
  return synced;
}

export function discardFailed(id) {
  removeFromQueue(id);
}

export function retryFailed(id) {
  updateItem(id, { status: 'pending', error: null });
}
