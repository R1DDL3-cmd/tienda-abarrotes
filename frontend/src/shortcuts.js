// Atajos de teclado configurables. Antes vivían hardcodeados dentro de
// POS.jsx y solo funcionaban ahí — por eso, por ejemplo, F5 no hacía nada
// estando en Contabilidad. Se separan en dos grupos:
//
// - "nav_*": funcionan en CUALQUIER pantalla, navegan a otra sección.
// - "pos_*": acciones que solo tienen sentido dentro del POS (buscar,
//   cobrar, cliente/fiado, historial) — solo se escuchan ahí.
//
// Ambos grupos se guardan bajo la misma configuración en localStorage para
// que la pantalla de Configuración los pueda remapear todos desde un solo
// lugar.
export const DEFAULT_SHORTCUTS = {
  nav_pos: { key: 'F5', label: 'Ir a Punto de Venta', hash: '#/pos' },
  nav_inventory: { key: 'F9', label: 'Ir a Inventario', hash: '#/inventory' },
  nav_purchases: { key: 'F10', label: 'Ir a Compras', hash: '#/purchases' },
  nav_accounting: { key: 'F11', label: 'Ir a Contabilidad', hash: '#/accounting' },
  nav_customers: { key: 'F12', label: 'Ir a Clientes', hash: '#/customers' },
  pos_search: { key: 'F2', label: 'Buscar producto' },
  pos_charge: { key: 'F4', label: 'Cobrar' },
  pos_customer: { key: 'F6', label: 'Cliente / Fiado' },
  pos_history: { key: 'F8', label: 'Historial' },
};

const STORAGE_KEY = 'keyboard_shortcuts';

export function getShortcuts() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) {}
  const merged = {};
  for (const id of Object.keys(DEFAULT_SHORTCUTS)) {
    merged[id] = { ...DEFAULT_SHORTCUTS[id], ...(saved[id] || {}), key: saved[id]?.key || DEFAULT_SHORTCUTS[id].key };
  }
  return merged;
}

export function setShortcutKey(id, key) {
  const current = getShortcuts();
  if (!current[id]) return;
  const toSave = {};
  for (const sid of Object.keys(current)) toSave[sid] = { key: current[sid].key };
  toSave[id] = { key };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

export function resetShortcuts() {
  localStorage.removeItem(STORAGE_KEY);
}

// Convierte un KeyboardEvent a la misma representación usada para guardar
// atajos (soporta teclas F1-F12 solas, o Ctrl+letra para evitar chocar con
// texto normal).
export function eventToKeyString(e) {
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (e.ctrlKey && e.key.length === 1) return `Ctrl+${e.key.toUpperCase()}`;
  return null;
}

export function matchesShortcut(e, shortcut) {
  const pressed = eventToKeyString(e) || e.key;
  return pressed === shortcut.key;
}
