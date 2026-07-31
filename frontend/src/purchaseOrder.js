// LÓGICA PURA DEL PEDIDO A PROVEEDOR
//
// Vive fuera del componente a propósito: así se puede probar sin navegador y
// contar pulsaciones de teclado de verdad (criterios de aceptación 1, 2 y 3).
// Nada de esto toca la red ni React — recibe un pedido y devuelve otro.

export const IVA = 0.16;

export function emptyOrder(supplier) {
  return {
    supplier_id: supplier ? supplier.id : null,
    supplier_name: supplier ? supplier.name : '',
    invoice_number: '',
    notes: '',
    kind: 'pending',        // 'pending' = pedido · 'completed' = compra ya recibida
    payment: 'cash',        // cash | card | transfer | credit
    due_date: '',
    items: [],
  };
}

// Costo del producto CON ESTE proveedor. El catálogo trae los vínculos como
// "idProveedor:costo"; si este proveedor no tiene precio propio, se cae al
// costo general del producto.
export function costFor(product, supplierId) {
  const pares = String(product?.supplier_prices || '').split(',').filter(Boolean);
  for (const par of pares) {
    const [id, precio] = par.split(':');
    if (Number(id) === Number(supplierId) && precio !== '' && precio != null) {
      const n = parseFloat(precio);
      if (Number.isFinite(n)) return n;
    }
  }
  return parseFloat(product?.purchase_price) || 0;
}

// ¿Este proveedor surte este producto? Se mira el vínculo múltiple y, por
// compatibilidad, también el proveedor habitual.
export function suppliesProduct(product, supplierId) {
  if (!product || !supplierId) return false;
  if (Number(product.supplier_id) === Number(supplierId)) return true;
  return String(product.supplier_ids || '')
    .split(',')
    .filter(Boolean)
    .some(id => Number(id) === Number(supplierId));
}

// Agrega (o acumula) un renglón. Devuelve { order, index, added } para que el
// componente sepa qué renglón resaltar sin volver a buscarlo.
export function addItem(order, product, { qty = 1, cost = null } = {}) {
  const idx = order.items.findIndex(i => i.product_id === product.id);
  const unit = cost != null ? cost : costFor(product, order.supplier_id);

  if (idx >= 0) {
    const items = order.items.map((i, n) => n === idx
      ? { ...i, quantity: round(i.quantity + qty), subtotal: round((i.quantity + qty) * i.unit_price) }
      : i);
    return { order: { ...order, items }, index: idx, added: false };
  }

  const item = {
    product_id: product.id,
    product_name: product.name,
    barcode: product.barcode || '',
    quantity: round(qty),
    unit_price: unit,
    subtotal: round(qty * unit),
    ajeno: !suppliesProduct(product, order.supplier_id),
  };
  return { order: { ...order, items: [...order.items, item] }, index: order.items.length, added: true };
}

export function setQty(order, index, qty) {
  if (!order.items[index] || !(qty > 0)) return order;
  const items = order.items.map((i, n) => n === index
    ? { ...i, quantity: round(qty), subtotal: round(qty * i.unit_price) }
    : i);
  return { ...order, items };
}

export function setCost(order, index, cost) {
  if (!order.items[index] || !(cost >= 0)) return order;
  const items = order.items.map((i, n) => n === index
    ? { ...i, unit_price: round(cost), subtotal: round(i.quantity * cost) }
    : i);
  return { ...order, items };
}

export function removeItem(order, index) {
  if (!order.items[index]) return order;
  return { ...order, items: order.items.filter((_, n) => n !== index) };
}

export function totals(order) {
  const subtotal = round((order.items || []).reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0));
  const tax = round(subtotal * IVA);
  return { subtotal, tax, total: round(subtotal + tax) };
}

function round(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

// ---------------------------------------------------------------
// RECEPCIÓN
// ---------------------------------------------------------------

// Al abrir la recepción, lo pedido se propone como recibido: el caso más
// común es que todo haya llegado igual, y ahí no se debería teclear nada.
export function receptionRows(purchase) {
  return (purchase.items || []).map(item => ({
    id: item.id,
    product_name: item.product_name,
    ordered_quantity: parseFloat(item.quantity) || 0,
    ordered_unit_price: parseFloat(item.unit_price) || 0,
    received_quantity: parseFloat(item.quantity) || 0,
    received_unit_price: parseFloat(item.unit_price) || 0,
  }));
}

export function allAsOrdered(rows) {
  return rows.map(r => ({ ...r, received_quantity: r.ordered_quantity, received_unit_price: r.ordered_unit_price }));
}

export function markMissing(rows, index) {
  return rows.map((r, n) => (n === index ? { ...r, received_quantity: 0 } : r));
}

export function setCell(rows, index, field, value) {
  const n = parseFloat(String(value).replace(',', '.'));
  return rows.map((r, i) => (i === index ? { ...r, [field]: Number.isFinite(n) && n >= 0 ? n : 0 } : r));
}

export function receptionTotal(rows) {
  const subtotal = round(rows.reduce((s, r) => s + r.received_quantity * r.received_unit_price, 0));
  return { subtotal, tax: round(subtotal * IVA), total: round(subtotal * (1 + IVA)) };
}

// ¿Hubo ajustes respecto a lo pedido? Sirve para avisar antes de salir con Esc.
export function hasAdjustments(rows) {
  return rows.some(r => r.received_quantity !== r.ordered_quantity || r.received_unit_price !== r.ordered_unit_price);
}
