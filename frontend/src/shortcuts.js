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

// Nombres "bonitos" para teclas cuyo e.key no se lee bien en pantalla.
const KEY_LABELS = {
  ' ': 'Espacio', 'Spacebar': 'Espacio',
  'ArrowUp': 'Flecha Arriba', 'ArrowDown': 'Flecha Abajo',
  'ArrowLeft': 'Flecha Izq', 'ArrowRight': 'Flecha Der',
  'Delete': 'Supr', 'Insert': 'Insert', 'Home': 'Inicio', 'End': 'Fin',
  'PageUp': 'Re Pág', 'PageDown': 'Av Pág', 'Enter': 'Enter',
  'Backspace': 'Retroceso', 'Escape': 'Escape', 'Tab': 'Tab',
};

// Convierte un KeyboardEvent a una representación de texto para guardar y
// comparar atajos. Acepta CUALQUIER tecla: F1-F12, letras, números, símbolos,
// y teclas con nombre (Enter, Supr, Inicio, Fin, flechas, etc.), además de
// combinaciones con Ctrl/Alt. Solo ignora las teclas modificadoras solas
// (Ctrl, Shift, Alt) porque se espera la tecla que las acompaña.
export function eventToKeyString(e) {
  const k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Dead') return null;

  // Prefijo de modificadores en orden fijo, para que capturar y comparar
  // produzcan siempre la misma cadena.
  let prefix = '';
  if (e.ctrlKey) prefix += 'Ctrl+';
  if (e.altKey) prefix += 'Alt+';
  if (e.metaKey) prefix += 'Meta+';

  let base;
  if (k === ' ' || k === 'Spacebar') base = 'Space';
  else if (k.length === 1) base = k.toUpperCase(); // letra, número o símbolo
  else base = k; // Enter, Delete, Home, End, F5, ArrowUp, Escape, Tab...

  return prefix + base;
}

// Etiqueta legible de una tecla guardada (ej. "Delete" -> "Supr", "F5" -> "F5",
// "Ctrl+A" -> "Ctrl + A", " " nunca llega aquí porque se guarda como "Space").
export function keyLabel(keyStr) {
  if (!keyStr) return '';
  const parts = keyStr.split('+');
  const base = parts.pop();
  const pretty = KEY_LABELS[base] || (base === 'Space' ? 'Espacio' : base);
  return [...parts, pretty].join(' + ');
}

export function matchesShortcut(e, shortcut) {
  const pressed = eventToKeyString(e);
  return pressed !== null && pressed === shortcut.key;
}
