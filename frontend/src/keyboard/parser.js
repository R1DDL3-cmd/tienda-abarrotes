// Parser de la línea de comando universal del POS.
//
// Función pura: recibe el texto crudo y devuelve una intención. No toca el
// carrito ni la red — eso lo hace quien la llama. Así se puede probar sola.
//
// Regla de oro: si no coincide con ningún prefijo, se asume que es un código
// de producto; si ese código no existe, el que llama cae a búsqueda por
// nombre SIN borrar lo que el usuario escribió.

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normalización para comparar/buscar: sin acentos, minúsculas, sin espacios
// sobrantes. No se aplica a los códigos (se conservan tal cual se teclearon).
export function normalize(s) {
  return stripAccents(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

const NUM = '\\d+(?:[.,]\\d+)?';

function toNumber(raw) {
  return parseFloat(String(raw).replace(',', '.'));
}

export function parseCommand(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { type: 'empty' };

  // ?texto — búsqueda incremental por nombre
  if (text.startsWith('?')) {
    return { type: 'search', query: normalize(text.slice(1)) };
  }

  // /comando arg — comandos del sistema
  if (text.startsWith('/')) {
    const rest = text.slice(1).trim();
    const [cmd, ...args] = rest.split(/\s+/);
    return { type: 'command', command: normalize(cmd), arg: args.join(' ') };
  }

  // #cliente — seleccionar o asignar cliente
  if (text.startsWith('#')) {
    return { type: 'customer', query: normalize(text.slice(1)) };
  }

  // %10 — descuento porcentual a la línea actual
  if (text.startsWith('%')) {
    const value = toNumber(text.slice(1));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { type: 'invalid', reason: 'Descuento inválido (usa %0 a %100)' };
    }
    return { type: 'discount_pct', value };
  }

  // =precio — precio manual en la línea actual
  if (text.startsWith('=')) {
    const value = toNumber(text.slice(1));
    if (!Number.isFinite(value) || value < 0) {
      return { type: 'invalid', reason: 'Precio inválido' };
    }
    return { type: 'set_price', value };
  }

  // *5 — cambia la cantidad de la línea actual
  const setQty = text.match(new RegExp(`^\\*(${NUM})$`));
  if (setQty) {
    const qty = toNumber(setQty[1]);
    if (!Number.isFinite(qty) || qty <= 0) return { type: 'invalid', reason: 'Cantidad inválida' };
    return { type: 'set_qty', qty };
  }

  // -codigo — quita esa línea del ticket
  if (text.startsWith('-') && text.length > 1) {
    return { type: 'remove', code: text.slice(1).trim() };
  }

  // $50*codigo — por importe (granel: "dame $50 de jamón")
  const byAmount = text.match(new RegExp(`^\\$(${NUM})\\s*[*x× ]\\s*(.+)$`, 'i'));
  if (byAmount) {
    const amount = toNumber(byAmount[1]);
    if (!Number.isFinite(amount) || amount <= 0) return { type: 'invalid', reason: 'Importe inválido' };
    return { type: 'product', code: byAmount[2].trim(), amount, qty: null, individual: false };
  }

  // 3i*codigo — piezas individuales (cigarros sueltos de una cajetilla)
  const individual = text.match(new RegExp(`^(${NUM})\\s*i\\s*[*x× ]\\s*(.+)$`, 'i'));
  if (individual) {
    const qty = toNumber(individual[1]);
    if (!Number.isFinite(qty) || qty <= 0) return { type: 'invalid', reason: 'Cantidad inválida' };
    return { type: 'product', code: individual[2].trim(), qty, individual: true, amount: null };
  }

  // 3*codigo | 3x codigo | 1.5 codigo — cantidad (admite decimales para kg/L)
  const withQty = text.match(new RegExp(`^(${NUM})\\s*[*x×]\\s*(.+)$`, 'i'))
    || text.match(new RegExp(`^(${NUM})\\s+(.+)$`));
  if (withQty) {
    const qty = toNumber(withQty[1]);
    if (!Number.isFinite(qty) || qty <= 0) return { type: 'invalid', reason: 'Cantidad inválida' };
    return { type: 'product', code: withQty[2].trim(), qty, individual: false, amount: null };
  }

  // Cualquier otra cosa: código de producto (o, si no existe, búsqueda)
  return { type: 'product', code: text, qty: 1, individual: false, amount: null };
}

// Comandos del sistema reconocidos por /comando, con sus alias. El valor es
// el id de la acción en el registro, para no duplicar lógica.
export const COMMAND_ALIASES = {
  corte: 'pos_close_day', cierre: 'pos_close_day', cerrar: 'pos_close_day',
  retiro: 'pos_withdrawal', retirar: 'pos_withdrawal',
  gasto: 'pos_expense', gastos: 'pos_expense',
  cliente: 'pos_customer', fiado: 'pos_customer',
  buscar: 'pos_search',
  historial: 'pos_history', ventas: 'pos_history',
  suspender: 'pos_suspend', pausar: 'pos_suspend',
  // "retomar" se llama aquí "reanudar" a propósito: con ambos empezando en
  // "ret", escribir /ret sería ambiguo con /retiro, que es mucho más frecuente.
  reanudar: 'pos_resume', recuperar: 'pos_resume',
  cobrar: 'pos_charge', pagar: 'pos_charge',
  ayuda: 'pos_help', teclas: 'pos_help',
  limpiar: 'pos_clear', vaciar: 'pos_clear',
};

// Resuelve /texto al id de acción, aceptando prefijos ("/ret" -> retiro).
// Varios alias que apuntan a la MISMA acción no se consideran ambigüedad
// (ej. "retiro" y "retirar"); solo se devuelve null si el prefijo podría
// significar dos acciones distintas, para no ejecutar algo que no se pidió.
export function resolveCommand(command) {
  if (!command) return null;
  if (COMMAND_ALIASES[command]) return COMMAND_ALIASES[command];
  const matches = Object.keys(COMMAND_ALIASES).filter(c => c.startsWith(command));
  const ids = new Set(matches.map(c => COMMAND_ALIASES[c]));
  return ids.size === 1 ? [...ids][0] : null;
}

// Sugerencia fantasma para el autocompletado en línea: devuelve el texto
// completo sugerido, o null. Solo aplica a /comandos (para códigos y nombres
// la sugerencia sale del catálogo, no del parser).
export function ghostSuggestion(raw) {
  const text = String(raw ?? '');
  if (!text.startsWith('/')) return null;
  const partial = normalize(text.slice(1));
  if (!partial) return null;
  const match = Object.keys(COMMAND_ALIASES).find(c => c.startsWith(partial) && c !== partial);
  return match ? '/' + match : null;
}
