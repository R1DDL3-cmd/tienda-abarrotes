// Parser de la línea de comando universal.
//
// Función pura: recibe el texto crudo y devuelve una intención. No toca el
// carrito, el pedido ni la red — eso lo hace quien la llama. Así se puede
// probar sola.
//
// Regla de oro: si no coincide con ningún prefijo, se asume que es un código
// de producto; si ese código no existe, el que llama cae a búsqueda por
// nombre SIN borrar lo que el usuario escribió.
//
// El MOTOR es uno solo (makeParser) y cada sección declara su gramática. Los
// prefijos significan lo mismo en todas partes —"=" es el precio del renglón
// activo, "#" la entidad relacionada— aunque el efecto concreto cambie: en el
// POS "=" es precio de venta y en Compras es costo de compra.

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

/**
 * Construye el parser de una sección.
 *
 * @param {string} entity        tipo devuelto por el prefijo "#" ('customer' | 'supplier')
 * @param {string} price         tipo devuelto por el prefijo "=" ('set_price' | 'set_cost')
 * @param {string} priceError    mensaje cuando el valor de "=" es inválido
 * @param {boolean} discount     ¿se admite "%" (descuento)?
 * @param {string} discountError mensaje cuando NO se admite
 * @param {boolean} individual   ¿se admite "3i*código" (piezas sueltas)?
 * @param {boolean} searchAll    ¿"??" fuerza buscar en todo el catálogo?
 */
export function makeParser({
  entity, price, priceError, discount = false, discountError,
  individual = false, searchAll = false,
}) {
  return function parse(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { type: 'empty' };

    // ?texto — búsqueda incremental por nombre.
    // En Compras, "??texto" amplía la búsqueda a todo el catálogo (por defecto
    // solo busca entre los productos del proveedor activo).
    if (text.startsWith('?')) {
      if (!searchAll) return { type: 'search', query: normalize(text.slice(1)) };
      if (text.startsWith('??')) return { type: 'search', query: normalize(text.slice(2)), all: true };
      return { type: 'search', query: normalize(text.slice(1)), all: false };
    }

    // /comando arg — comandos del sistema
    if (text.startsWith('/')) {
      const rest = text.slice(1).trim();
      const [cmd, ...args] = rest.split(/\s+/);
      return { type: 'command', command: normalize(cmd), arg: args.join(' ') };
    }

    // #entidad — cliente en el POS, proveedor en Compras
    if (text.startsWith('#')) {
      return { type: entity, query: normalize(text.slice(1)) };
    }

    // %10 — descuento porcentual a la línea actual
    if (text.startsWith('%')) {
      if (!discount) return { type: 'invalid', reason: discountError };
      const value = toNumber(text.slice(1));
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return { type: 'invalid', reason: 'Descuento inválido (usa %0 a %100)' };
      }
      return { type: 'discount_pct', value };
    }

    // =precio — precio/costo manual en la línea actual
    if (text.startsWith('=')) {
      const value = toNumber(text.slice(1));
      if (!Number.isFinite(value) || value < 0) {
        return { type: 'invalid', reason: priceError };
      }
      return { type: price, value };
    }

    // *5 — cambia la cantidad de la línea actual
    const setQty = text.match(new RegExp(`^\\*(${NUM})$`));
    if (setQty) {
      const qty = toNumber(setQty[1]);
      if (!Number.isFinite(qty) || qty <= 0) return { type: 'invalid', reason: 'Cantidad inválida' };
      return { type: 'set_qty', qty };
    }

    // -codigo — quita esa línea
    if (text.startsWith('-') && text.length > 1) {
      return { type: 'remove', code: text.slice(1).trim() };
    }

    // $50*codigo — por importe (granel en el POS: "dame $50 de jamón";
    // en Compras: "me llegaron $500 de refresco")
    const byAmount = text.match(new RegExp(`^\\$(${NUM})\\s*[*x× ]\\s*(.+)$`, 'i'));
    if (byAmount) {
      const amount = toNumber(byAmount[1]);
      if (!Number.isFinite(amount) || amount <= 0) return { type: 'invalid', reason: 'Importe inválido' };
      return { type: 'product', code: byAmount[2].trim(), amount, qty: null, individual: false };
    }

    // 3i*codigo — piezas individuales (cigarros sueltos de una cajetilla)
    if (individual) {
      const suelta = text.match(new RegExp(`^(${NUM})\\s*i\\s*[*x× ]\\s*(.+)$`, 'i'));
      if (suelta) {
        const qty = toNumber(suelta[1]);
        if (!Number.isFinite(qty) || qty <= 0) return { type: 'invalid', reason: 'Cantidad inválida' };
        return { type: 'product', code: suelta[2].trim(), qty, individual: true, amount: null };
      }
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
  };
}

// --- Punto de venta ---
export const parseCommand = makeParser({
  entity: 'customer',
  price: 'set_price',
  priceError: 'Precio inválido',
  discount: true,
  individual: true,
});

// --- Compras ---
// "=" es el COSTO al proveedor y "#" cambia de proveedor: mismo concepto que
// en el POS, distinta entidad. El descuento no aplica: en una compra el
// descuento del proveedor ya viene incluido en el costo que se teclea.
export const parsePurchase = makeParser({
  entity: 'supplier',
  price: 'set_cost',
  priceError: 'Costo inválido',
  discount: false,
  discountError: 'En compras el descuento va en el costo: usa =precio',
  individual: false,
  searchAll: true,
});

// ---------------------------------------------------------------
// Comandos "/algo"
// ---------------------------------------------------------------

// Válidos desde CUALQUIER sección: navegan primero y ejecutan después. Son la
// forma más corta de saltar de una tarea a otra sin soltar el teclado
// (ej. desde el POS: "/pedido" abre Compras con un pedido nuevo listo).
export const GLOBAL_COMMANDS = {
  caja: 'nav_pos', venta: 'nav_pos', pos: 'nav_pos',
  inventario: 'nav_inventory', productos: 'nav_inventory',
  compras: 'nav_purchases', proveedores: 'nav_purchases',
  pedido: 'nav_new_order',
  contabilidad: 'nav_accounting',
  clientes: 'nav_customers',
};

// Comandos del POS, con sus alias. El valor es el id de la acción en el
// registro, para no duplicar lógica.
export const COMMAND_ALIASES = {
  ...GLOBAL_COMMANDS,
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
  ayuda: 'sys_help', teclas: 'sys_help',
  limpiar: 'pos_clear', vaciar: 'pos_clear',
};

// Comandos de Compras. Ojo con "/re": "recibir" y "reanudar" comparten
// prefijo, así que /re es ambiguo a propósito y no adivina — se documenta
// /rec y /rea en la hoja de referencia.
export const PURCHASE_COMMANDS = {
  ...GLOBAL_COMMANDS,
  sugerir: 'compras_suggest', sugerencia: 'compras_suggest', reponer: 'compras_suggest',
  recibir: 'compras_receive',
  pagar: 'compras_payable', abonar: 'compras_payable', deuda: 'compras_payable',
  vincular: 'compras_link_supplier', ligar: 'compras_link_supplier',
  guardar: 'compras_save_order',
  suspender: 'compras_suspend', pausar: 'compras_suspend',
  reanudar: 'compras_resume',
  nuevo: 'compras_new_product', alta: 'compras_new_product',
  proveedor: 'compras_pick_supplier',
  historial: 'compras_orders', pedidos: 'compras_orders',
  imprimir: 'compras_print_order',
  buscar: 'compras_search_product',
  ayuda: 'sys_help', teclas: 'sys_help',
};

// Resuelve /texto al id de acción, aceptando prefijos ("/ret" -> retiro).
// Varios alias que apuntan a la MISMA acción no se consideran ambigüedad
// (ej. "retiro" y "retirar"); solo se devuelve null si el prefijo podría
// significar dos acciones distintas, para no ejecutar algo que no se pidió.
export function resolveCommand(command, tabla = COMMAND_ALIASES) {
  if (!command) return null;
  if (tabla[command]) return tabla[command];
  const matches = Object.keys(tabla).filter(c => c.startsWith(command));
  const ids = new Set(matches.map(c => tabla[c]));
  return ids.size === 1 ? [...ids][0] : null;
}

// Sugerencia fantasma para el autocompletado en línea: devuelve el texto
// completo sugerido, o null. Solo aplica a /comandos (para códigos y nombres
// la sugerencia sale del catálogo, no del parser).
export function ghostSuggestion(raw, tabla = COMMAND_ALIASES) {
  const text = String(raw ?? '');
  if (!text.startsWith('/')) return null;
  const partial = normalize(text.slice(1));
  if (!partial) return null;
  const match = Object.keys(tabla).find(c => c.startsWith(partial) && c !== partial);
  return match ? '/' + match : null;
}
