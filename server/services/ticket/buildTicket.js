// Arma la estructura Ticket (§10) a partir de una venta real de la base de
// datos. Es el ÚNICO lugar que traduce el modelo de la tienda al modelo del
// ticket; los renderizadores no saben nada de SQL.
const fs = require('fs');
const path = require('path');
const { aCentavos } = require('./columns');

let _plantilla = null;

function rutaPlantilla() {
  // Permite sobreescribir la plantilla sin tocar el .asar empaquetado.
  if (process.env.TICKET_TEMPLATE) return process.env.TICKET_TEMPLATE;
  return path.join(__dirname, '..', '..', 'templates', 'ticket.json');
}

function cargarPlantilla({ recargar = false } = {}) {
  if (_plantilla && !recargar) return _plantilla;
  const raw = fs.readFileSync(rutaPlantilla(), 'utf8');
  const p = JSON.parse(raw);
  validarPlantilla(p);
  _plantilla = p;
  return p;
}

// Si los anchos de una rejilla no suman el total, el ticket saldría
// desalineado en producción. Es preferible fallar al arrancar.
function validarPlantilla(p) {
  for (const [ancho, rejilla] of Object.entries(p.rejillas || {})) {
    const suma = Object.entries(rejilla.campos || {})
      .filter(([k]) => !k.startsWith('_'))
      .reduce((s, [, v]) => s + v, 0);
    if (suma !== Number(ancho)) {
      throw new Error(`Plantilla de ticket inválida: la rejilla de ${ancho} columnas suma ${suma}`);
    }
  }
  return true;
}

const ETIQUETA_PAGO = {
  cash: 'EFECTIVO', card: 'TARJETA', transfer: 'TRANSFERENCIA',
  credit: 'FIADO', fiado: 'FIADO',
};

// Nunca se imprime el número completo de una tarjeta (PCI-DSS): solo los
// últimos 4 dígitos, y solo si el cobro los capturó.
function referenciaPago(p) {
  const partes = [];
  if (p.marca) partes.push(String(p.marca).toUpperCase());
  if (p.ultimos4) partes.push(String(p.ultimos4).slice(-4));
  if (p.autorizacion) partes.push('AUTO ' + p.autorizacion);
  return partes.join(' ');
}

/**
 * @param sale      fila de `sales` con `items` ya cargados
 * @param store     settings de la tienda (nombre, dirección, teléfono, pie)
 * @param plantilla plantilla ya cargada
 */
function construirTicket(sale, store = {}, plantilla = cargarPlantilla(), opciones = {}) {
  const items = sale.items || [];

  const renglones = items.map(it => {
    const cant = Number(it.quantity) || 0;
    const precio = aCentavos(it.unit_price);
    const descuento = aCentavos(it.discount || 0);
    // El total de la línea se recalcula en centavos enteros para que la suma
    // cuadre al centavo con el TOTAL (criterio 7).
    const total = Math.round(precio * cant) - descuento;
    return {
      cant: Number.isInteger(cant) ? cant : Number(cant.toFixed(3)),
      sku: it.barcode || it.product_id || '',
      descripcion: it.product_name + (it.is_individual ? ' (PZA)' : ''),
      precio_regular: precio,
      // La tienda no maneja lista de precios promocional: si hubo descuento
      // en la línea, el precio efectivo se muestra como precio de promoción.
      precio_promo: descuento > 0 && cant > 0 ? Math.round((precio * cant - descuento) / cant) : null,
      total,
      nota_promo: descuento > 0 ? `Descuento @ -${(descuento / 100).toFixed(2)}` : null,
    };
  });

  const totalRenglones = renglones.reduce((s, r) => s + r.total, 0);
  const descuentoGlobal = aCentavos(sale.discount || 0);
  const total = totalRenglones - descuentoGlobal;

  let pagos = [];
  try {
    const detalle = sale.payment_details ? JSON.parse(sale.payment_details) : [];
    pagos = (Array.isArray(detalle) ? detalle : []).map(p => ({
      tipo: ETIQUETA_PAGO[p.method] || String(p.method || '').toUpperCase(),
      referencia: referenciaPago(p),
      importe: aCentavos(p.amount),
    }));
  } catch (e) { pagos = []; }

  const pagado = pagos.reduce((s, p) => s + p.importe, 0);
  // El cambio solo existe si hubo efectivo; con tarjeta exacta es 0.
  const cambio = Math.max(0, pagado - total);

  const impuestos = [];
  if (plantilla.bloques?.impuestos && plantilla.impuestos?.iva_incluido) {
    const tasa = Number(plantilla.impuestos.tasa) || 16;
    // IVA CONTENIDO en el precio, no sumado encima.
    const base = Math.round(total / (1 + tasa / 100));
    impuestos.push({ etiqueta: `IVA ${tasa}% INCLUIDO`, importe: total - base });
  }

  const folioCfg = plantilla.folio || {};
  const folio = (folioCfg.prefijo || '') + String(sale.id ?? 0).padStart(folioCfg.digitos || 6, '0');

  return {
    negocio: {
      nombre: store.store_name || 'TIENDA',
      sucursal: store.store_sucursal || '',
      domicilio: store.store_address || '',
      telefono: store.store_phone || '',
      logo: !!store.store_logo,
      logo_raster: null, // se llena en el transporte si hay logo convertido
    },
    fiscal: null, // la tienda no expide facturas: bloque desactivado
    folio,
    fecha_hora: formatearFecha(sale.created_at),
    caja: store.caja || '01',
    cajero: sale.created_by_name || '',
    cliente: sale.customer_name || '',
    renglones,
    renglones_count: renglones.length,
    articulos: renglones.reduce((s, r) => s + Math.abs(r.cant), 0),
    impuestos,
    total,
    pagos,
    cambio,
    monedero: plantilla.bloques?.monedero ? (plantilla.monedero || []) : [],
    facturacion_url: plantilla.bloques?.facturacion ? (store.facturacion_url || '') : '',
    leyenda_cierre: store.ticket_footer || plantilla.leyendas?.cierre || '',
    ...opciones,
  };
}

// created_at viene en UTC de SQLite; el ticket debe mostrar la hora de la
// tienda (misma corrección que el resto del sistema, ver server/bizdate.js).
function formatearFecha(created_at) {
  if (!created_at) return '';
  const iso = String(created_at).includes('T') ? created_at : String(created_at).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return String(created_at);
  const local = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ` +
         `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}`;
}

module.exports = { construirTicket, cargarPlantilla, validarPlantilla, formatearFecha };
