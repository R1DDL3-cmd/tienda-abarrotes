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
  // --- Punto de venta ---
  CAPTURA: 'captura',   // armando el ticket (estado base)
  COBRO: 'cobro',       // pantalla de pago
  CAMBIO: 'cambio',     // mostrando el cambio a devolver
  BUSQUEDA: 'busqueda', // buscador de productos superpuesto
  MODAL: 'modal',       // cualquier otro modal: solo Enter/Esc
  // --- Compras ---
  PROVEEDOR: 'proveedor',     // estado base: elegir a quién se le pide
  PEDIDO: 'pedido',           // armando el pedido (línea de comando)
  CONFIRMAR: 'confirmar',     // resumen antes de guardar el pedido
  PENDIENTES: 'pendientes',   // lista de pedidos del proveedor
  RECEPCION: 'recepcion',     // rejilla de lo que realmente llegó
  PORPAGAR: 'porpagar',       // cuentas por pagar
  ABONO: 'abono',             // abono a una compra a crédito
  // --- Resto de secciones ---
  INVENTARIO: 'inventario',
  CLIENTES: 'clientes',
  ABONO_CLIENTE: 'abono_cliente',
  CONTABILIDAD: 'contabilidad',
  CONFIGURACION: 'configuracion',
  PROYECTOR: 'proyector',
};

// CLASES DE ESTADO — la pieza que hace verificable "misma tecla = mismo
// significado". No se pueden comparar todos los estados entre sí: F1 es
// "Ayuda" mientras se captura y "Efectivo" mientras se cobra, y ambas cosas
// están bien porque son contextos distintos. La regla real es:
//
//   dentro de una MISMA clase, una tecla no puede significar dos cosas
//   distintas en dos secciones distintas (salvo excepción declarada).
//
// Eso es lo que verifica la prueba automática (ver frontend/tests).
export const STATE_CLASSES = {
  [STATES.CAPTURA]: 'captura',
  [STATES.PROVEEDOR]: 'captura',
  [STATES.PEDIDO]: 'captura',
  [STATES.COBRO]: 'pago',
  [STATES.ABONO]: 'pago',
  [STATES.RECEPCION]: 'rejilla',
  [STATES.BUSQUEDA]: 'lista',
  [STATES.PENDIENTES]: 'lista',
  [STATES.PORPAGAR]: 'lista',
  [STATES.CAMBIO]: 'confirmacion',
  [STATES.CONFIRMAR]: 'confirmacion',
  [STATES.MODAL]: 'modal',
  [STATES.INVENTARIO]: 'captura',
  [STATES.CLIENTES]: 'captura',
  [STATES.CONTABILIDAD]: 'captura',
  [STATES.CONFIGURACION]: 'captura',
  [STATES.PROYECTOR]: 'captura',
  [STATES.ABONO_CLIENTE]: 'pago',
};

export function stateClass(state) {
  return STATE_CLASSES[state] || 'modal';
}

// Todas las acciones. `keys[0]` es la tecla principal; el resto son alias.
// `needsEmptyInput` = solo se dispara si la línea de comando está vacía (así
// "+" o "Supr" siguen sirviendo para escribir/borrar dentro del campo).
//
// `semantic` es el SIGNIFICADO de la tecla, no su efecto concreto: "buscar"
// vale igual para buscar un producto en el POS que un proveedor en Compras.
// La prueba de consistencia exige que, dentro de una misma clase de estado,
// una tecla tenga un solo `semantic` en todo el sistema. Cuando hay que
// desviarse, se declara `keyException` con el motivo por escrito.
const DEFINITIONS = [
  // ================= SISTEMA (todas las secciones) =================
  // Son globales: siguen funcionando aunque haya un recuadro abierto. Las
  // acciones propias del estado ganan sobre estas (por eso F1 es Ayuda al
  // capturar y Efectivo al cobrar).
  {
    id: 'sys_help', nombre: 'Ayuda', descripcion: 'Muestra todas las teclas disponibles aquí',
    keys: ['F1'], global: true, semantic: 'ayuda', group: 'Sistema', order: 90, helpBar: true,
  },
  {
    id: 'sys_palette', nombre: 'Paleta de comandos', descripcion: 'Busca cualquier función por su nombre, en cualquier sección',
    keys: ['F10', 'Ctrl+K'], global: true, semantic: 'paleta', group: 'Sistema', order: 80, helpBar: true,
  },

  // ---------- CAPTURA (POS) ----------
  {
    id: 'pos_search', nombre: 'Buscar producto', descripcion: 'Busca por nombre cuando no tienes el código',
    keys: ['F2'], states: [STATES.CAPTURA], semantic: 'buscar', group: 'Venta', order: 20, helpBar: true,
  },
  {
    id: 'pos_customer', nombre: 'Cliente / Fiado', descripcion: 'Asigna un cliente a la venta para vender a crédito',
    keys: ['F3'], states: [STATES.CAPTURA], semantic: 'entidad', group: 'Venta', order: 30, helpBar: true,
  },
  {
    id: 'pos_charge', nombre: 'Cobrar', descripcion: 'Cierra la venta y abre la pantalla de cobro',
    keys: ['F4', 'F12'], states: [STATES.CAPTURA], semantic: 'principal', group: 'Venta', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'pos_discount', nombre: 'Descuento', descripcion: 'Aplica un descuento a la línea seleccionada',
    keys: ['F5'], states: [STATES.CAPTURA], roles: ['admin'], semantic: 'descuento', group: 'Venta', order: 40, helpBar: true,
    // ÚNICA excepción declarada del sistema. En el resto de la app F5 significa
    // "hacer en lote" (sugerir pedido, todo llegó igual, edición masiva).
    keyException: 'F5 = Descuento solo en el POS. Es memoria muscular ganada en la v1.2.0, es exclusiva del dueño y no existe fuera de esta pantalla, así que no compite con F5 = "en lote" del resto del sistema.',
  },
  {
    id: 'pos_suspend', nombre: 'Suspender venta', descripcion: 'Guarda el ticket para atender a otro cliente',
    keys: ['F6'], states: [STATES.CAPTURA], semantic: 'suspender', group: 'Venta', order: 50, helpBar: true,
  },
  {
    id: 'pos_resume', nombre: 'Retomar venta', descripcion: 'Recupera un ticket suspendido',
    keys: ['F7'], states: [STATES.CAPTURA], semantic: 'retomar', group: 'Venta', order: 60, helpBar: true,
  },
  {
    id: 'pos_history', nombre: 'Historial', descripcion: 'Ventas del día',
    keys: ['F8'], states: [STATES.CAPTURA], semantic: 'historial', group: 'Venta', order: 70, helpBar: true,
  },
  {
    // F9 dejó de ser alias de Supr al llegar la Fase 2: es la única tecla de
    // función libre para "cuentas y saldos", que Compras y Clientes necesitan.
    // Supr, que es la documentada, no se toca.
    id: 'pos_remove_line', nombre: 'Quitar línea', descripcion: 'Elimina del ticket la línea seleccionada',
    keys: ['Delete'], states: [STATES.CAPTURA], needsEmptyInput: true, semantic: 'quitar', group: 'Ticket', order: 15, helpBar: true,
  },
  {
    id: 'pos_undo', nombre: 'Deshacer', descripcion: 'Revierte el último cambio del ticket',
    keys: ['Ctrl+Z'], states: [STATES.CAPTURA], semantic: 'deshacer', group: 'Ticket', order: 16,
  },
  {
    id: 'pos_qty_up', nombre: 'Aumentar cantidad', descripcion: 'Suma 1 a la línea seleccionada',
    keys: ['+'], states: [STATES.CAPTURA], needsEmptyInput: true, semantic: 'cantidad-mas', group: 'Ticket', order: 17,
  },
  {
    id: 'pos_qty_down', nombre: 'Disminuir cantidad', descripcion: 'Resta 1 a la línea seleccionada',
    keys: ['-'], states: [STATES.CAPTURA], needsEmptyInput: true, semantic: 'cantidad-menos', group: 'Ticket', order: 18,
  },
  {
    id: 'pos_line_prev', nombre: 'Línea anterior', descripcion: 'Sube en el ticket',
    keys: ['ArrowUp'], states: [STATES.CAPTURA], semantic: 'mover-arriba', group: 'Ticket', order: 19,
  },
  {
    id: 'pos_line_next', nombre: 'Línea siguiente', descripcion: 'Baja en el ticket',
    keys: ['ArrowDown'], states: [STATES.CAPTURA], semantic: 'mover-abajo', group: 'Ticket', order: 19,
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

  // ---------- PAGO (POS cobro + abono a proveedor) ----------
  // Los dígitos escriben el monto, así que las denominaciones van en teclas de
  // función: si "1" valiera $20, teclear "100" sería imposible. Las mismas
  // teclas sirven para cobrar una venta y para pagarle a un proveedor.
  {
    id: 'cobro_cash', nombre: 'Efectivo', descripcion: 'Forma de pago: efectivo',
    keys: ['F1'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'pago-efectivo', group: 'Pago', order: 10, helpBar: true,
  },
  {
    id: 'cobro_card', nombre: 'Tarjeta', descripcion: 'Forma de pago: tarjeta',
    keys: ['F2'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'pago-tarjeta', group: 'Pago', order: 11, helpBar: true,
  },
  {
    id: 'cobro_transfer', nombre: 'Transferencia', descripcion: 'Forma de pago: transferencia',
    keys: ['F3'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'pago-transferencia', group: 'Pago', order: 12, helpBar: true,
  },
  {
    id: 'cobro_mixed', nombre: 'Pago mixto', descripcion: 'Agrega otra forma de pago al mismo movimiento',
    keys: ['F4'], states: [STATES.COBRO], semantic: 'pago-mixto', group: 'Pago', order: 13, helpBar: true,
  },
  { id: 'cobro_d20', nombre: '+$20', descripcion: 'Suma un billete de 20', keys: ['F5'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'denominacion-20', group: 'Denominación', order: 20, helpBar: true, amount: 20 },
  { id: 'cobro_d50', nombre: '+$50', descripcion: 'Suma un billete de 50', keys: ['F6'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'denominacion-50', group: 'Denominación', order: 21, helpBar: true, amount: 50 },
  { id: 'cobro_d100', nombre: '+$100', descripcion: 'Suma un billete de 100', keys: ['F7'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'denominacion-100', group: 'Denominación', order: 22, helpBar: true, amount: 100 },
  { id: 'cobro_d200', nombre: '+$200', descripcion: 'Suma un billete de 200', keys: ['F8'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'denominacion-200', group: 'Denominación', order: 23, helpBar: true, amount: 200 },
  { id: 'cobro_d500', nombre: '+$500', descripcion: 'Suma un billete de 500', keys: ['F9'], states: [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE], semantic: 'denominacion-500', group: 'Denominación', order: 24, helpBar: true, amount: 500 },

  // ================= COMPRAS =================
  // Estado base: elegir proveedor. Enter avanza al pedido.
  {
    id: 'compras_search_supplier', nombre: 'Buscar proveedor', descripcion: 'Filtra la lista de proveedores',
    keys: ['F2'], states: [STATES.PROVEEDOR], semantic: 'buscar', group: 'Compras', order: 20, helpBar: true,
  },
  {
    id: 'compras_pick_supplier', nombre: 'Elegir proveedor', descripcion: 'Abre el selector de proveedor',
    keys: ['F3'], states: [STATES.PROVEEDOR, STATES.PEDIDO], semantic: 'entidad', group: 'Compras', order: 30, helpBar: true,
  },
  {
    id: 'compras_new_order', nombre: 'Nuevo pedido', descripcion: 'Empieza un pedido para el proveedor activo',
    keys: ['F4'], states: [STATES.PROVEEDOR], semantic: 'principal', group: 'Compras', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'compras_new_supplier', nombre: 'Nuevo proveedor', descripcion: 'Da de alta un proveedor',
    keys: ['Insert'], states: [STATES.PROVEEDOR], semantic: 'alta', group: 'Compras', order: 35, helpBar: true,
  },
  {
    id: 'compras_orders', nombre: 'Pedidos del proveedor', descripcion: 'Historial de pedidos y compras de este proveedor',
    keys: ['F8'], states: [STATES.PROVEEDOR, STATES.PEDIDO], semantic: 'historial', group: 'Compras', order: 70, helpBar: true,
  },
  {
    id: 'compras_payable', nombre: 'Cuentas por pagar', descripcion: 'Lo que se le debe a los proveedores',
    keys: ['F9'], states: [STATES.PROVEEDOR, STATES.PEDIDO], roles: ['admin'], semantic: 'cuentas', group: 'Compras', order: 75, helpBar: true,
  },
  {
    id: 'compras_resume', nombre: 'Retomar pedido', descripcion: 'Recupera un pedido suspendido',
    keys: ['F7'], states: [STATES.PROVEEDOR, STATES.PEDIDO], semantic: 'retomar', group: 'Compras', order: 60, helpBar: true,
  },
  {
    id: 'compras_supplier_prev', nombre: 'Proveedor anterior', descripcion: 'Sube en la lista de proveedores',
    keys: ['ArrowUp'], states: [STATES.PROVEEDOR], semantic: 'mover-arriba', group: 'Compras', order: 19,
  },
  {
    id: 'compras_supplier_next', nombre: 'Proveedor siguiente', descripcion: 'Baja en la lista de proveedores',
    keys: ['ArrowDown'], states: [STATES.PROVEEDOR], semantic: 'mover-abajo', group: 'Compras', order: 19,
  },

  // Estado PEDIDO: el equivalente a CAPTURA del POS.
  {
    id: 'compras_search_product', nombre: 'Buscar producto', descripcion: 'Busca entre los productos de este proveedor',
    keys: ['F2'], states: [STATES.PEDIDO], semantic: 'buscar', group: 'Pedido', order: 20, helpBar: true,
  },
  {
    id: 'compras_save_order', nombre: 'Guardar pedido', descripcion: 'Cierra el pedido y pasa a confirmarlo',
    keys: ['F4', 'F12'], states: [STATES.PEDIDO], semantic: 'principal', group: 'Pedido', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'compras_suggest', nombre: 'Sugerir reposición', descripcion: 'Llena el pedido con lo que se está acabando',
    keys: ['F5'], states: [STATES.PEDIDO], semantic: 'lote', group: 'Pedido', order: 40, helpBar: true,
  },
  {
    id: 'compras_suspend', nombre: 'Suspender pedido', descripcion: 'Guarda el pedido a medias para seguirlo después',
    keys: ['F6'], states: [STATES.PEDIDO], semantic: 'suspender', group: 'Pedido', order: 50, helpBar: true,
  },
  {
    id: 'compras_new_product', nombre: 'Alta rápida de producto', descripcion: 'Crea un producto y lo liga a este proveedor',
    keys: ['Insert'], states: [STATES.PEDIDO], roles: ['admin', 'inventory'], semantic: 'alta', group: 'Pedido', order: 35,
  },
  {
    id: 'compras_remove_line', nombre: 'Quitar renglón', descripcion: 'Saca del pedido el renglón seleccionado',
    keys: ['Delete'], states: [STATES.PEDIDO], needsEmptyInput: true, semantic: 'quitar', group: 'Pedido', order: 15, helpBar: true,
  },
  {
    id: 'compras_undo', nombre: 'Deshacer', descripcion: 'Revierte el último cambio del pedido',
    keys: ['Ctrl+Z'], states: [STATES.PEDIDO, STATES.RECEPCION], semantic: 'deshacer', group: 'Pedido', order: 16,
  },
  {
    id: 'compras_qty_up', nombre: 'Aumentar cantidad', descripcion: 'Suma 1 al renglón seleccionado',
    keys: ['+'], states: [STATES.PEDIDO], needsEmptyInput: true, semantic: 'cantidad-mas', group: 'Pedido', order: 17,
  },
  {
    id: 'compras_qty_down', nombre: 'Disminuir cantidad', descripcion: 'Resta 1 al renglón seleccionado',
    keys: ['-'], states: [STATES.PEDIDO], needsEmptyInput: true, semantic: 'cantidad-menos', group: 'Pedido', order: 18,
  },
  {
    id: 'compras_line_prev', nombre: 'Renglón anterior', descripcion: 'Sube en el pedido',
    keys: ['ArrowUp'], states: [STATES.PEDIDO], semantic: 'mover-arriba', group: 'Pedido', order: 19,
  },
  {
    id: 'compras_line_next', nombre: 'Renglón siguiente', descripcion: 'Baja en el pedido',
    keys: ['ArrowDown'], states: [STATES.PEDIDO], semantic: 'mover-abajo', group: 'Pedido', order: 19,
  },
  {
    id: 'compras_print_order', nombre: 'Imprimir pedido', descripcion: 'Saca el pedido en la impresora de tickets',
    keys: ['Ctrl+P'], states: [STATES.PEDIDO, STATES.PENDIENTES], semantic: 'imprimir', group: 'Pedido', order: 45,
  },
  {
    id: 'compras_link_supplier', nombre: 'Ligar producto al proveedor', descripcion: 'Añade el producto del renglón activo al catálogo de este proveedor',
    keys: [], states: [STATES.PEDIDO], roles: ['admin', 'inventory'], group: 'Pedido', order: 46,
  },

  // Estado CONFIRMAR: cómo se paga y qué tipo de movimiento es.
  {
    id: 'compras_confirm_credit', nombre: 'A crédito', descripcion: 'La compra queda a deber: se va a cuentas por pagar',
    keys: ['F9'], states: [STATES.CONFIRMAR], semantic: 'cuentas', group: 'Confirmar', order: 20, helpBar: true,
  },
  {
    id: 'compras_confirm_cash', nombre: 'Pago de contado: efectivo', descripcion: 'Se paga en el momento, en efectivo',
    keys: ['F1'], states: [STATES.CONFIRMAR], semantic: 'pago-efectivo', group: 'Confirmar', order: 10, helpBar: true,
  },
  {
    id: 'compras_confirm_card', nombre: 'Pago de contado: tarjeta', descripcion: 'Se paga en el momento, con tarjeta',
    keys: ['F2'], states: [STATES.CONFIRMAR], semantic: 'pago-tarjeta', group: 'Confirmar', order: 11, helpBar: true,
  },
  {
    id: 'compras_confirm_transfer', nombre: 'Pago de contado: transferencia', descripcion: 'Se paga en el momento, por transferencia',
    keys: ['F3'], states: [STATES.CONFIRMAR], semantic: 'pago-transferencia', group: 'Confirmar', order: 12, helpBar: true,
  },
  {
    id: 'compras_confirm_kind_prev', nombre: 'Tipo anterior', descripcion: 'Alterna entre pedido pendiente y compra ya recibida',
    keys: ['ArrowLeft'], states: [STATES.CONFIRMAR], semantic: 'mover-izq', group: 'Confirmar', order: 30,
  },
  {
    id: 'compras_confirm_kind_next', nombre: 'Tipo siguiente', descripcion: 'Alterna entre pedido pendiente y compra ya recibida',
    keys: ['ArrowRight'], states: [STATES.CONFIRMAR], semantic: 'mover-der', group: 'Confirmar', order: 31,
  },
  {
    id: 'compras_confirm_save', nombre: 'Confirmar', descripcion: 'Guarda el pedido o la compra',
    keys: ['F4'], states: [STATES.CONFIRMAR], semantic: 'principal', group: 'Confirmar', order: 5, helpBar: true, primary: true,
  },

  // Estado PENDIENTES: lista de pedidos del proveedor.
  {
    id: 'compras_receive', nombre: 'Recibir pedido', descripcion: 'Abre la recepción del pedido seleccionado',
    keys: ['F4'], states: [STATES.PENDIENTES], semantic: 'principal', group: 'Pedidos', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'compras_order_prev', nombre: 'Pedido anterior', descripcion: 'Sube en la lista de pedidos',
    keys: ['ArrowUp'], states: [STATES.PENDIENTES], semantic: 'mover-arriba', group: 'Pedidos', order: 19,
  },
  {
    id: 'compras_order_next', nombre: 'Pedido siguiente', descripcion: 'Baja en la lista de pedidos',
    keys: ['ArrowDown'], states: [STATES.PENDIENTES], semantic: 'mover-abajo', group: 'Pedidos', order: 19,
  },

  // Estado RECEPCIÓN: rejilla tipo hoja de cálculo.
  {
    id: 'recepcion_confirm', nombre: 'Confirmar recepción', descripcion: 'Inventaría lo que llegó y cierra el pedido',
    keys: ['F4'], states: [STATES.RECEPCION], semantic: 'principal', group: 'Recepción', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'recepcion_all_ok', nombre: 'Todo llegó igual', descripcion: 'Marca cada renglón tal como se pidió: el caso más común, en una tecla',
    keys: ['F5'], states: [STATES.RECEPCION], semantic: 'lote', group: 'Recepción', order: 20, helpBar: true,
  },
  {
    id: 'recepcion_missing', nombre: 'Este no llegó', descripcion: 'Pone en cero el renglón activo sin borrarlo del pedido',
    keys: ['Delete'], states: [STATES.RECEPCION], semantic: 'quitar', group: 'Recepción', order: 30, helpBar: true,
  },
  {
    id: 'recepcion_row_prev', nombre: 'Renglón anterior', descripcion: 'Sube en la rejilla',
    keys: ['ArrowUp'], states: [STATES.RECEPCION], semantic: 'mover-arriba', group: 'Recepción', order: 40,
  },
  {
    id: 'recepcion_row_next', nombre: 'Renglón siguiente', descripcion: 'Baja en la rejilla',
    keys: ['ArrowDown'], states: [STATES.RECEPCION], semantic: 'mover-abajo', group: 'Recepción', order: 41,
  },
  {
    id: 'recepcion_col_prev', nombre: 'Columna anterior', descripcion: 'De precio recibido a cantidad recibida',
    keys: ['ArrowLeft'], states: [STATES.RECEPCION], semantic: 'mover-izq', group: 'Recepción', order: 42,
  },
  {
    id: 'recepcion_col_next', nombre: 'Columna siguiente', descripcion: 'De cantidad recibida a precio recibido',
    keys: ['ArrowRight', 'Tab'], states: [STATES.RECEPCION], semantic: 'mover-der', group: 'Recepción', order: 43, helpBar: true,
  },

  // Estado POR PAGAR y ABONO.
  {
    id: 'porpagar_pay', nombre: 'Abonar', descripcion: 'Registra un pago a la compra seleccionada',
    keys: ['F4'], states: [STATES.PORPAGAR], roles: ['admin'], semantic: 'principal', group: 'Por pagar', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'porpagar_prev', nombre: 'Compra anterior', descripcion: 'Sube en la lista de deudas',
    keys: ['ArrowUp'], states: [STATES.PORPAGAR], roles: ['admin'], semantic: 'mover-arriba', group: 'Por pagar', order: 19,
  },
  {
    id: 'porpagar_next', nombre: 'Compra siguiente', descripcion: 'Baja en la lista de deudas',
    keys: ['ArrowDown'], states: [STATES.PORPAGAR], roles: ['admin'], semantic: 'mover-abajo', group: 'Por pagar', order: 19,
  },

  // ================= INVENTARIO =================
  {
    id: 'inv_search', nombre: 'Buscar producto', descripcion: 'Filtra el inventario por nombre o código',
    keys: ['F2'], states: [STATES.INVENTARIO], semantic: 'buscar', group: 'Inventario', order: 20, helpBar: true,
  },
  {
    id: 'inv_supplier', nombre: 'Filtrar por proveedor', descripcion: 'Muestra solo lo que surte un proveedor',
    keys: ['F3'], states: [STATES.INVENTARIO], semantic: 'entidad', group: 'Inventario', order: 30, helpBar: true,
  },
  {
    id: 'inv_edit', nombre: 'Editar producto', descripcion: 'Abre el producto activo para editarlo',
    keys: ['F4'], states: [STATES.INVENTARIO], semantic: 'principal', group: 'Inventario', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'inv_bulk', nombre: 'Edición masiva', descripcion: 'Cambia de golpe todos los productos marcados',
    keys: ['F5'], states: [STATES.INVENTARIO], semantic: 'lote', group: 'Inventario', order: 40, helpBar: true,
  },
  {
    id: 'inv_kardex', nombre: 'Kardex', descripcion: 'Historial de movimientos del producto activo',
    keys: ['F8'], states: [STATES.INVENTARIO], semantic: 'historial', group: 'Inventario', order: 70, helpBar: true,
  },
  {
    id: 'inv_new', nombre: 'Alta rápida', descripcion: 'Da de alta un producto nuevo',
    keys: ['Insert'], states: [STATES.INVENTARIO], semantic: 'alta', group: 'Inventario', order: 35, helpBar: true,
  },
  {
    id: 'inv_mark', nombre: 'Marcar / desmarcar', descripcion: 'Selecciona el producto activo para la edición masiva',
    keys: ['Space'], states: [STATES.INVENTARIO], needsEmptyInput: true, semantic: 'marcar', group: 'Inventario', order: 45, helpBar: true,
  },
  {
    id: 'inv_labels', nombre: 'Imprimir etiquetas', descripcion: 'Etiquetas de precio de los productos marcados',
    keys: ['Ctrl+P'], states: [STATES.INVENTARIO], semantic: 'imprimir', group: 'Inventario', order: 50,
  },
  {
    id: 'inv_delete', nombre: 'Dar de baja', descripcion: 'Desactiva el producto activo',
    keys: ['Delete'], states: [STATES.INVENTARIO], needsEmptyInput: true, semantic: 'quitar', group: 'Inventario', order: 55,
  },
  {
    id: 'inv_row_prev', nombre: 'Producto anterior', descripcion: 'Sube en la lista',
    keys: ['ArrowUp'], states: [STATES.INVENTARIO], semantic: 'mover-arriba', group: 'Inventario', order: 60,
  },
  {
    id: 'inv_row_next', nombre: 'Producto siguiente', descripcion: 'Baja en la lista',
    keys: ['ArrowDown'], states: [STATES.INVENTARIO], semantic: 'mover-abajo', group: 'Inventario', order: 61,
  },
  {
    id: 'inv_page_prev', nombre: 'Página anterior', descripcion: 'Tramo anterior de la lista',
    keys: ['PageUp'], states: [STATES.INVENTARIO], semantic: 'bloque-ant', group: 'Inventario', order: 62,
  },
  {
    id: 'inv_page_next', nombre: 'Página siguiente', descripcion: 'Tramo siguiente de la lista',
    keys: ['PageDown'], states: [STATES.INVENTARIO], semantic: 'bloque-sig', group: 'Inventario', order: 63,
  },

  // ================= CLIENTES =================
  {
    id: 'cli_search', nombre: 'Buscar cliente', descripcion: 'Filtra por nombre o teléfono',
    keys: ['F2'], states: [STATES.CLIENTES], semantic: 'buscar', group: 'Clientes', order: 20, helpBar: true,
  },
  {
    id: 'cli_pay', nombre: 'Abonar', descripcion: 'Registra un abono del cliente activo',
    keys: ['F4'], states: [STATES.CLIENTES], semantic: 'principal', group: 'Clientes', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'cli_history', nombre: 'Historial', descripcion: 'Compras y abonos del cliente activo',
    keys: ['F8'], states: [STATES.CLIENTES], semantic: 'historial', group: 'Clientes', order: 70, helpBar: true,
  },
  {
    id: 'cli_new', nombre: 'Alta rápida', descripcion: 'Da de alta un cliente nuevo',
    keys: ['Insert'], states: [STATES.CLIENTES], semantic: 'alta', group: 'Clientes', order: 35, helpBar: true,
  },
  {
    id: 'cli_debtors', nombre: 'Solo con saldo', descripcion: 'Muestra únicamente a quienes deben',
    keys: ['F9'], states: [STATES.CLIENTES], semantic: 'cuentas', group: 'Clientes', order: 75, helpBar: true,
  },
  {
    id: 'cli_row_prev', nombre: 'Cliente anterior', descripcion: 'Sube en la lista',
    keys: ['ArrowUp'], states: [STATES.CLIENTES], semantic: 'mover-arriba', group: 'Clientes', order: 60,
  },
  {
    id: 'cli_row_next', nombre: 'Cliente siguiente', descripcion: 'Baja en la lista',
    keys: ['ArrowDown'], states: [STATES.CLIENTES], semantic: 'mover-abajo', group: 'Clientes', order: 61,
  },

  // ================= CONTABILIDAD =================
  {
    id: 'con_export', nombre: 'Exportar', descripcion: 'Descarga lo que se está viendo',
    keys: ['F4'], states: [STATES.CONTABILIDAD], semantic: 'principal', group: 'Contabilidad', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'con_search', nombre: 'Buscar', descripcion: 'Filtra la tabla activa',
    keys: ['F2'], states: [STATES.CONTABILIDAD], semantic: 'buscar', group: 'Contabilidad', order: 20, helpBar: true,
  },
  {
    id: 'con_tab_prev', nombre: 'Pestaña anterior', descripcion: 'Cambia de pestaña hacia la izquierda',
    keys: ['ArrowLeft'], states: [STATES.CONTABILIDAD, STATES.CONFIGURACION], semantic: 'mover-izq', group: 'Pestañas', order: 30, helpBar: true,
  },
  {
    id: 'con_tab_next', nombre: 'Pestaña siguiente', descripcion: 'Cambia de pestaña hacia la derecha',
    keys: ['ArrowRight'], states: [STATES.CONTABILIDAD, STATES.CONFIGURACION], semantic: 'mover-der', group: 'Pestañas', order: 31, helpBar: true,
  },
  {
    id: 'con_period_prev', nombre: 'Periodo anterior', descripcion: 'Mueve el rango de fechas hacia atrás',
    keys: ['PageUp'], states: [STATES.CONTABILIDAD], semantic: 'bloque-ant', group: 'Contabilidad', order: 40, helpBar: true,
  },
  {
    id: 'con_period_next', nombre: 'Periodo siguiente', descripcion: 'Mueve el rango de fechas hacia adelante',
    keys: ['PageDown'], states: [STATES.CONTABILIDAD], semantic: 'bloque-sig', group: 'Contabilidad', order: 41, helpBar: true,
  },

  // ================= CONFIGURACIÓN =================
  {
    id: 'cfg_save', nombre: 'Guardar', descripcion: 'Guarda los cambios de esta pestaña',
    keys: ['F4'], states: [STATES.CONFIGURACION], semantic: 'principal', group: 'Configuración', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'cfg_export_keys', nombre: 'Exportar teclas (JSON)', descripcion: 'Guarda tu perfil de teclas en un archivo',
    keys: [], states: [STATES.CONFIGURACION], group: 'Configuración', order: 50,
  },
  {
    id: 'cfg_import_keys', nombre: 'Importar teclas (JSON)', descripcion: 'Carga un perfil de teclas de otro equipo',
    keys: [], states: [STATES.CONFIGURACION], group: 'Configuración', order: 51,
  },
  {
    id: 'cfg_reset_keys', nombre: 'Restablecer teclas', descripcion: 'Vuelve a las teclas de fábrica',
    keys: [], states: [STATES.CONFIGURACION], group: 'Configuración', order: 52,
  },

  // ================= PROYECTOR DE COMPRA =================
  {
    id: 'proj_search', nombre: 'Buscar producto', descripcion: 'Filtra el proyector por nombre',
    keys: ['F2'], states: [STATES.PROYECTOR], semantic: 'buscar', group: 'Proyector', order: 20, helpBar: true,
  },
  {
    id: 'proj_open', nombre: 'Ver detalle', descripcion: 'Abre el análisis del producto activo',
    keys: ['F4'], states: [STATES.PROYECTOR], semantic: 'principal', group: 'Proyector', order: 10, helpBar: true, primary: true,
  },
  {
    id: 'proj_row_prev', nombre: 'Producto anterior', descripcion: 'Sube en los resultados',
    keys: ['ArrowUp'], states: [STATES.PROYECTOR], semantic: 'mover-arriba', group: 'Proyector', order: 60,
  },
  {
    id: 'proj_row_next', nombre: 'Producto siguiente', descripcion: 'Baja en los resultados',
    keys: ['ArrowDown'], states: [STATES.PROYECTOR], semantic: 'mover-abajo', group: 'Proyector', order: 61,
  },
  {
    id: 'proj_sort_prev', nombre: 'Ordenar por la columna anterior', descripcion: 'Mueve la columna de orden a la izquierda',
    keys: ['ArrowLeft'], states: [STATES.PROYECTOR], semantic: 'mover-izq', group: 'Proyector', order: 30, helpBar: true,
  },
  {
    id: 'proj_sort_next', nombre: 'Ordenar por la columna siguiente', descripcion: 'Mueve la columna de orden a la derecha (repetir invierte el orden)',
    keys: ['ArrowRight'], states: [STATES.PROYECTOR], semantic: 'mover-der', group: 'Proyector', order: 31, helpBar: true,
  },

  // ---------- Navegación (global) ----------
  // Ctrl+N manda en la app de escritorio; Alt+N es el alias que SÍ sobrevive
  // en el navegador de la tablet, donde Ctrl+número cambia de pestaña y no se
  // puede interceptar.
  { id: 'nav_pos', nombre: 'Ir a Punto de Venta', descripcion: 'Abre la pantalla de ventas', keys: ['Ctrl+1', 'Alt+1'], hash: '#/pos', global: true, semantic: 'navegar', group: 'Navegación', order: 10 },
  { id: 'nav_inventory', nombre: 'Ir a Inventario', descripcion: 'Abre el inventario', keys: ['Ctrl+2', 'Alt+2'], hash: '#/inventory', roles: ['admin', 'inventory'], global: true, semantic: 'navegar', group: 'Navegación', order: 11 },
  { id: 'nav_purchases', nombre: 'Ir a Compras', descripcion: 'Abre compras y proveedores', keys: ['Ctrl+3', 'Alt+3'], hash: '#/purchases', global: true, semantic: 'navegar', group: 'Navegación', order: 12 },
  { id: 'nav_accounting', nombre: 'Ir a Contabilidad', descripcion: 'Abre contabilidad', keys: ['Ctrl+4', 'Alt+4'], hash: '#/accounting', roles: ['admin'], global: true, semantic: 'navegar', group: 'Navegación', order: 13 },
  { id: 'nav_customers', nombre: 'Ir a Clientes', descripcion: 'Abre clientes y fiado', keys: ['Ctrl+5', 'Alt+5'], hash: '#/customers', roles: ['admin'], global: true, semantic: 'navegar', group: 'Navegación', order: 14 },
  { id: 'nav_predictions', nombre: 'Ir al Proyector de Compra', descripcion: 'Abre el proyector de reposición', keys: ['Ctrl+6', 'Alt+6'], hash: '#/predictions', roles: ['admin'], global: true, semantic: 'navegar', group: 'Navegación', order: 15 },
  { id: 'nav_settings', nombre: 'Ir a Configuración', descripcion: 'Abre la configuración del sistema', keys: ['Ctrl+7', 'Alt+7'], hash: '#/settings', roles: ['admin'], global: true, semantic: 'navegar', group: 'Navegación', order: 16 },
  { id: 'nav_new_order', nombre: 'Nuevo pedido a proveedor', descripcion: 'Abre Compras con un pedido nuevo listo, desde donde estés', keys: [], hash: '#/purchases?nuevo=1', global: true, group: 'Navegación', order: 17 },
];

const byId = new Map(DEFINITIONS.map(a => [a.id, a]));

export function getAction(id) { return byId.get(id); }
export function allActions() { return DEFINITIONS; }

// ---------------------------------------------------------------
// Perfil de teclas del usuario (localStorage, exportable a JSON)
// ---------------------------------------------------------------
const PROFILE_KEY = 'keymap_profile';
const LEGACY_KEY = 'keyboard_shortcuts';
const PROFILE_VERSION = 3;

// Acciones que cambiaron de id al volverse universales en la Fase 2 (dejaron
// de ser "del POS"). Si el usuario les había puesto una tecla propia, se
// conserva; si no, simplemente toma la de fábrica.
const ID_RENAMES = {
  pos_help: 'sys_help',
  pos_palette: 'sys_palette',
};

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

// Traslada las teclas personalizadas a los ids nuevos y descarta las de
// acciones que ya no existen, para que un perfil viejo no arrastre basura.
function migrateIds(keys) {
  const out = {};
  for (const [id, val] of Object.entries(keys || {})) {
    const destino = ID_RENAMES[id] || id;
    if (byId.has(destino) && Array.isArray(val) && val.length) out[destino] = val;
  }
  return out;
}

export function getProfile() {
  if (_profile) return _profile;
  const saved = readJSON(PROFILE_KEY);
  if (saved && saved.version === PROFILE_VERSION) {
    _profile = saved;
  } else if (saved && saved.keys) {
    // Perfil de una versión anterior: se conserva lo que el usuario cambió.
    _profile = { version: PROFILE_VERSION, keys: migrateIds(saved.keys) };
    saveProfile(_profile);
  } else {
    _profile = { version: PROFILE_VERSION, keys: migrateIds(migrateLegacy()) };
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
//
// Una acción global cuya tecla está tomada por una del estado NO se lista: en
// cobro, F1 es Efectivo, así que la barra de ayuda no debe ofrecer también
// "F1 Ayuda". Es la misma regla de precedencia que aplica resolveKey.
export function actionsFor({ state, role }) {
  const disponibles = DEFINITIONS
    .filter(a => activeInState(a, state) && allowedForRole(a, role))
    .map(a => ({ ...a, keys: keysFor(a.id) }));

  const tecladasPorElEstado = new Set(
    disponibles.filter(a => !a.global).flatMap(a => a.keys)
  );

  return disponibles
    .filter(a => !a.global || !a.keys.some(k => tecladasPorElEstado.has(k)))
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
