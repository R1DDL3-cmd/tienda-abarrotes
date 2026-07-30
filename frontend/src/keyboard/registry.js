// REGISTRO CENTRAL DE ACCIONES — única fuente de verdad de la interacción.
//
// De aquí se generan automáticamente: los atajos de teclado, la paleta de
// comandos, la barra de ayuda contextual y la pantalla de configuración de
// teclas. Ningún componente debe tener una tecla escrita a mano: solo declara
// una acción aquí y provee su handler.
//
// Las definiciones son DATOS PUROS (sin closures) para que se puedan exportar
// a JSON, versionar y editar por usuario. El comportamiento lo inyecta el
// componente en tiempo de ejecución (ver input.js), no el registro.

// Estados de la máquina de interacción. Cada uno tiene su propio mapa de
// teclas: la misma tecla física puede significar cosas distintas según dónde
// esté el usuario, y la barra de ayuda siempre muestra lo que aplica.
export const STATES = {
  CAPTURA: 'captura',   // armando el ticket (estado base)
  COBRO: 'cobro',       // pantalla de pago
  CAMBIO: 'cambio',     // mostrando el cambio a devolver
  BUSQUEDA: 'busqueda', // buscador de productos superpuesto
  MODAL: 'modal',       // cualquier otro modal: solo Enter/Esc
};

// Todas las acciones. `keys[0]` es la tecla principal; el resto son alias.
// `needsEmptyInput` = solo se dispara si la línea de comando está vacía (así
// "+" o "Supr" siguen sirviendo para escribir/borrar dentro del campo).
const DEFINITIONS = [
  // ---------- CAPTURA ----------
  {
    id: 'pos_help', nombre: 'Ayuda', descripcion: 'Muestra todas las teclas disponibles',
    keys: ['F1'], states: [STATES.CAPTURA], group: 'Sistema', order: 90, helpBar: true,
  },
  {
    id: 'pos_search', nombre: 'Buscar producto', descripcion: 'Busca por nombre cuando no tienes el código',
    keys: ['F2'], states: [STATES.CAPTURA], group: 'Venta', order: 20, helpBar: true,
  },
  {
    id: 'pos_customer', nombre: 'Cliente / Fiado', descripcion: 'Asigna un cliente a la venta para vender a crédito',
    keys: ['F3'], states: [STATES.CAPTURA], group: 'Venta', order: 30, helpBar: true,
  },
  {
    id: 'pos_charge', nombre: 'Cobrar', descripcion: 'Cierra la venta y abre la pantalla de cobro',
    keys: ['F4', 'F12'], states: [STATES.CAPTURA], group: 'Venta', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'pos_discount', nombre: 'Descuento', descripcion: 'Aplica un descuento a la línea seleccionada',
    keys: ['F5'], states: [STATES.CAPTURA], roles: ['admin'], group: 'Venta', order: 40, helpBar: true,
  },
  {
    id: 'pos_suspend', nombre: 'Suspender venta', descripcion: 'Guarda el ticket para atender a otro cliente',
    keys: ['F6'], states: [STATES.CAPTURA], group: 'Venta', order: 50, helpBar: true,
  },
  {
    id: 'pos_resume', nombre: 'Retomar venta', descripcion: 'Recupera un ticket suspendido',
    keys: ['F7'], states: [STATES.CAPTURA], group: 'Venta', order: 60, helpBar: true,
  },
  {
    id: 'pos_history', nombre: 'Historial', descripcion: 'Ventas del día',
    keys: ['F8'], states: [STATES.CAPTURA], group: 'Venta', order: 70, helpBar: true,
  },
  {
    id: 'pos_remove_line', nombre: 'Quitar línea', descripcion: 'Elimina del ticket la línea seleccionada',
    keys: ['Delete', 'F9'], states: [STATES.CAPTURA], needsEmptyInput: true, group: 'Ticket', order: 15, helpBar: true,
  },
  {
    id: 'pos_palette', nombre: 'Paleta de comandos', descripcion: 'Busca cualquier función por su nombre',
    keys: ['F10', 'Ctrl+K'], states: [STATES.CAPTURA], group: 'Sistema', order: 80, helpBar: true,
  },
  {
    id: 'pos_undo', nombre: 'Deshacer', descripcion: 'Revierte el último cambio del ticket',
    keys: ['Ctrl+Z'], states: [STATES.CAPTURA], group: 'Ticket', order: 16,
  },
  {
    id: 'pos_qty_up', nombre: 'Aumentar cantidad', descripcion: 'Suma 1 a la línea seleccionada',
    keys: ['+'], states: [STATES.CAPTURA], needsEmptyInput: true, group: 'Ticket', order: 17,
  },
  {
    id: 'pos_qty_down', nombre: 'Disminuir cantidad', descripcion: 'Resta 1 a la línea seleccionada',
    keys: ['-'], states: [STATES.CAPTURA], needsEmptyInput: true, group: 'Ticket', order: 18,
  },
  {
    id: 'pos_line_prev', nombre: 'Línea anterior', descripcion: 'Sube en el ticket',
    keys: ['ArrowUp'], states: [STATES.CAPTURA], group: 'Ticket', order: 19,
  },
  {
    id: 'pos_line_next', nombre: 'Línea siguiente', descripcion: 'Baja en el ticket',
    keys: ['ArrowDown'], states: [STATES.CAPTURA], group: 'Ticket', order: 19,
  },
  {
    id: 'pos_clear', nombre: 'Vaciar ticket', descripcion: 'Quita todos los productos (se puede deshacer)',
    keys: [], states: [STATES.CAPTURA], group: 'Ticket', order: 21,
  },
  {
    id: 'pos_withdrawal', nombre: 'Retiro de efectivo', descripcion: 'Registra dinero que sale de la caja',
    keys: [], states: [STATES.CAPTURA], group: 'Caja', order: 40,
  },
  {
    id: 'pos_expense', nombre: 'Registrar gasto', descripcion: 'Anota un gasto pagado desde la caja',
    keys: [], states: [STATES.CAPTURA], group: 'Caja', order: 41,
  },
  {
    id: 'pos_close_day', nombre: 'Cerrar día', descripcion: 'Hace el corte de caja del día',
    keys: [], states: [STATES.CAPTURA], group: 'Caja', order: 42,
  },

  // ---------- COBRO ----------
  // En cobro los dígitos escriben el monto, así que las denominaciones van en
  // teclas de función: si "1" valiera $20, teclear "100" sería imposible.
  {
    id: 'cobro_cash', nombre: 'Efectivo', descripcion: 'Forma de pago: efectivo',
    keys: ['F1'], states: [STATES.COBRO], group: 'Pago', order: 10, helpBar: true,
  },
  {
    id: 'cobro_card', nombre: 'Tarjeta', descripcion: 'Forma de pago: tarjeta',
    keys: ['F2'], states: [STATES.COBRO], group: 'Pago', order: 11, helpBar: true,
  },
  {
    id: 'cobro_transfer', nombre: 'Transferencia', descripcion: 'Forma de pago: transferencia',
    keys: ['F3'], states: [STATES.COBRO], group: 'Pago', order: 12, helpBar: true,
  },
  {
    id: 'cobro_mixed', nombre: 'Pago mixto', descripcion: 'Agrega otra forma de pago a la misma venta',
    keys: ['F4'], states: [STATES.COBRO], group: 'Pago', order: 13, helpBar: true,
  },
  { id: 'cobro_d20', nombre: '+$20', descripcion: 'Suma un billete de 20', keys: ['F5'], states: [STATES.COBRO], group: 'Denominación', order: 20, helpBar: true, amount: 20 },
  { id: 'cobro_d50', nombre: '+$50', descripcion: 'Suma un billete de 50', keys: ['F6'], states: [STATES.COBRO], group: 'Denominación', order: 21, helpBar: true, amount: 50 },
  { id: 'cobro_d100', nombre: '+$100', descripcion: 'Suma un billete de 100', keys: ['F7'], states: [STATES.COBRO], group: 'Denominación', order: 22, helpBar: true, amount: 100 },
  { id: 'cobro_d200', nombre: '+$200', descripcion: 'Suma un billete de 200', keys: ['F8'], states: [STATES.COBRO], group: 'Denominación', order: 23, helpBar: true, amount: 200 },
  { id: 'cobro_d500', nombre: '+$500', descripcion: 'Suma un billete de 500', keys: ['F9'], states: [STATES.COBRO], group: 'Denominación', order: 24, helpBar: true, amount: 500 },

  // ---------- Navegación (global) ----------
  { id: 'nav_pos', nombre: 'Ir a Punto de Venta', descripcion: 'Abre la pantalla de ventas', keys: ['Ctrl+1'], hash: '#/pos', global: true, group: 'Navegación', order: 10 },
  { id: 'nav_inventory', nombre: 'Ir a Inventario', descripcion: 'Abre el inventario', keys: ['Ctrl+2'], hash: '#/inventory', roles: ['admin', 'inventory'], global: true, group: 'Navegación', order: 11 },
  { id: 'nav_purchases', nombre: 'Ir a Compras', descripcion: 'Abre compras y proveedores', keys: ['Ctrl+3'], hash: '#/purchases', global: true, group: 'Navegación', order: 12 },
  { id: 'nav_accounting', nombre: 'Ir a Contabilidad', descripcion: 'Abre contabilidad', keys: ['Ctrl+4'], hash: '#/accounting', roles: ['admin'], global: true, group: 'Navegación', order: 13 },
  { id: 'nav_customers', nombre: 'Ir a Clientes', descripcion: 'Abre clientes y fiado', keys: ['Ctrl+5'], hash: '#/customers', roles: ['admin'], global: true, group: 'Navegación', order: 14 },
];

const byId = new Map(DEFINITIONS.map(a => [a.id, a]));

export function getAction(id) { return byId.get(id); }
export function allActions() { return DEFINITIONS; }

// ---------------------------------------------------------------
// Perfil de teclas del usuario (localStorage, exportable a JSON)
// ---------------------------------------------------------------
const PROFILE_KEY = 'keymap_profile';
const LEGACY_KEY = 'keyboard_shortcuts';
const PROFILE_VERSION = 2;

// Teclas que tenían las acciones antes de este rediseño. Si el usuario nunca
// las personalizó, se descartan para que tome los defaults nuevos; si sí las
// cambió a propósito, se respeta su elección.
const LEGACY_DEFAULTS = {
  nav_pos: 'F5', nav_inventory: 'F9', nav_purchases: 'F10',
  nav_accounting: 'F11', nav_customers: 'F12',
  pos_search: 'F2', pos_charge: 'F4', pos_customer: 'F6', pos_history: 'F8',
};

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; }
}

function migrateLegacy() {
  const legacy = readJSON(LEGACY_KEY);
  if (!legacy) return {};
  const overrides = {};
  for (const [id, val] of Object.entries(legacy)) {
    const key = val && val.key;
    if (!key) continue;
    // Solo se conserva lo que el usuario cambió de verdad respecto al default viejo.
    if (LEGACY_DEFAULTS[id] && LEGACY_DEFAULTS[id] === key) continue;
    overrides[id] = [key];
  }
  return overrides;
}

let _profile = null;

export function getProfile() {
  if (_profile) return _profile;
  const saved = readJSON(PROFILE_KEY);
  if (saved && saved.version === PROFILE_VERSION) {
    _profile = saved;
  } else {
    _profile = { version: PROFILE_VERSION, keys: migrateLegacy() };
    saveProfile(_profile);
  }
  return _profile;
}

function saveProfile(profile) {
  _profile = profile;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) {}
}

// Teclas efectivas de una acción: las del perfil del usuario si las cambió,
// si no las de fábrica.
export function keysFor(actionId) {
  const p = getProfile();
  const override = p.keys && p.keys[actionId];
  if (override && override.length) return override;
  const def = byId.get(actionId);
  return def ? def.keys : [];
}

export function setKeys(actionId, keys) {
  const p = getProfile();
  saveProfile({ ...p, keys: { ...p.keys, [actionId]: keys } });
}

export function resetKeys() {
  saveProfile({ version: PROFILE_VERSION, keys: {} });
  try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
}

export function exportKeymap() {
  const out = {};
  for (const a of DEFINITIONS) out[a.id] = keysFor(a.id);
  return JSON.stringify({ version: PROFILE_VERSION, keys: out }, null, 2);
}

export function importKeymap(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (!parsed || !parsed.keys) throw new Error('Archivo de teclas inválido');
  const keys = {};
  for (const [id, val] of Object.entries(parsed.keys)) {
    if (byId.has(id) && Array.isArray(val)) keys[id] = val;
  }
  saveProfile({ version: PROFILE_VERSION, keys });
}

// ---------------------------------------------------------------
// Consultas: de aquí salen la barra de ayuda, la paleta y el keymap
// ---------------------------------------------------------------
function allowedForRole(action, role) {
  return !action.roles || action.roles.includes(role);
}

function activeInState(action, state) {
  if (action.global) return true;
  return action.states && action.states.includes(state);
}

// Acciones disponibles ahora mismo (estado + rol), ordenadas.
export function actionsFor({ state, role }) {
  return DEFINITIONS
    .filter(a => activeInState(a, state) && allowedForRole(a, role))
    .map(a => ({ ...a, keys: keysFor(a.id) }))
    .sort((x, y) => (x.order || 999) - (y.order || 999));
}

// Resuelve qué acción corresponde a una tecla en el estado actual. Las
// acciones del estado ganan sobre las globales (por eso F1 es "Ayuda" en
// captura pero "Efectivo" en cobro).
export function resolveKey(keyString, { state, role }) {
  const candidates = DEFINITIONS.filter(a =>
    allowedForRole(a, role) && activeInState(a, state) && keysFor(a.id).includes(keyString)
  );
  if (candidates.length === 0) return null;
  return candidates.find(a => !a.global) || candidates[0];
}

// Búsqueda para la paleta de comandos: tolerante a acentos y parcial.
export function searchActions(query, { state, role }) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query).trim();
  const pool = DEFINITIONS
    .filter(a => allowedForRole(a, role) && (a.global || activeInState(a, state)))
    .map(a => ({ ...a, keys: keysFor(a.id) }));
  if (!q) return pool.sort((x, y) => (x.order || 999) - (y.order || 999));
  return pool
    .map(a => {
      const name = norm(a.nombre);
      const desc = norm(a.descripcion);
      let score = -1;
      if (name.startsWith(q)) score = 0;
      else if (name.includes(q)) score = 1;
      else if (desc.includes(q)) score = 2;
      return { a, score };
    })
    .filter(x => x.score >= 0)
    .sort((x, y) => x.score - y.score || (x.a.order || 999) - (y.a.order || 999))
    .map(x => x.a);
}
