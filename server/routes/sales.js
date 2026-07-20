const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { businessToday, bizDate } = require('../bizdate');

const router = express.Router();

const VALID_PAYMENT_METHODS = ['cash', 'card', 'transfer', 'credit', 'fiado'];

// Efectivo que realmente entra al cajón con esta venta: lo pagado en efectivo
// menos el cambio entregado. El POS manda el efectivo RECIBIDO (puede exceder
// el total — el excedente es cambio y sale del mismo cajón), y el cambio
// siempre se da en efectivo. Tarjeta/transferencia/fiado no tocan el cajón.
function computeCashNet(payments, total) {
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const cashPaid = payments.filter(p => p.method === 'cash').reduce((sum, p) => sum + (p.amount || 0), 0);
  const changeGiven = Math.max(0, totalPaid - total);
  return Math.max(0, cashPaid - changeGiven);
}

// El ticket impreso necesita mostrar el saldo pendiente del cliente cuando la
// venta fue a crédito/fiado, no solo el total de esta venta — de lo contrario
// el cliente no tiene forma de saber cuánto debe en total.
function attachCustomerBalance(db, sale) {
  if (sale && sale.customer_id) {
    const customer = db.prepare('SELECT balance FROM customers WHERE id = ?').get(sale.customer_id);
    sale.customer_balance = customer ? customer.balance : null;
  }
  return sale;
}

router.post('/', authMiddleware, (req, res) => {
  const db = getDB();
  const { items, payments, discount = 0, customer_id, customer_name, client_id, client_created_at } = req.body;

  // Idempotencia para la cola de ventas offline: si la tablet ya envió esta
  // venta antes (la confirmación se perdió en el camino y reintentó), no
  // crearla dos veces — devolver la que ya existe.
  if (client_id) {
    const existing = attachCustomerBalance(db, db.prepare('SELECT * FROM sales WHERE client_id = ?').get(client_id));
    if (existing) {
      const existingItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(existing.id);
      return res.status(200).json({ sale: existing, items: existingItems, _idempotent: true });
    }
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
  }

  if (!payments || payments.length === 0) {
    return res.status(400).json({ error: 'Debe especificar al menos un método de pago' });
  }

  const isCashier = req.user.role === 'cashier';

  // Validación estricta de números: !item.quantity solo rechazaba 0 — una
  // cantidad NEGATIVA pasaba, lo que AUMENTABA el stock y generaba una venta
  // con total negativo. Lo mismo aplicaba a precios y descuentos.
  for (const p of payments) {
    if (!VALID_PAYMENT_METHODS.includes(p.method)) {
      return res.status(400).json({ error: 'Método de pago inválido' });
    }
    p.amount = Number(p.amount);
    if (!Number.isFinite(p.amount) || p.amount < 0) {
      return res.status(400).json({ error: 'Monto de pago inválido' });
    }
  }

  let subtotal = 0;
  for (const item of items) {
    item.quantity = Number(item.quantity);
    item.unit_price = Number(item.unit_price);
    item.discount = Number(item.discount) || 0;
    if (!item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      return res.status(400).json({ error: 'Cantidad de producto inválida' });
    }
    if (!Number.isFinite(item.unit_price) || item.unit_price <= 0) {
      return res.status(400).json({ error: 'Precio de producto inválido' });
    }
    if (item.discount < 0 || item.discount > item.unit_price * item.quantity) {
      return res.status(400).json({ error: 'Descuento de producto inválido' });
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (!product) {
      return res.status(404).json({ error: `Producto ID ${item.product_id} no encontrado` });
    }

    // Venta individual (ej. cigarros sueltos de una cajetilla): el stock del
    // producto se lleva en unidades de PAQUETE, así que vender N piezas
    // sueltas descuenta N/units_per_package paquetes, no N paquetes enteros.
    item.is_individual = !!(item.is_individual && product.sellable_individually);
    if (item.is_individual && (!product.units_per_package || !product.individual_price)) {
      return res.status(400).json({ error: `${product.name} no está configurado para venta individual` });
    }
    item.stock_delta = item.is_individual ? (item.quantity / product.units_per_package) : item.quantity;

    if (product.stock < item.stock_delta) {
      return res.status(400).json({ error: `Stock insuficiente para ${product.name}. Disponible: ${product.stock}` });
    }
    const expectedPrice = item.is_individual ? product.individual_price : product.sale_price;
    if (isCashier && item.unit_price !== expectedPrice) {
      item.unit_price = expectedPrice;
    }
    if (isCashier && item.discount > 0) {
      item.discount = 0;
    }
    item.product_name = product.name;
    item.barcode = product.barcode;
    item.discount = item.discount || 0;
    item.subtotal = (item.unit_price * item.quantity) - item.discount;
    subtotal += item.subtotal;
  }

  const globalDiscount = Number(discount) || 0;
  if (globalDiscount < 0 || globalDiscount > subtotal) {
    return res.status(400).json({ error: 'Descuento global inválido' });
  }

  if (isCashier && globalDiscount > 0) {
    return res.status(403).json({ error: 'El cajero no puede aplicar descuentos globales' });
  }

  if (isCashier && payments.some(p => p.method === 'credit' || p.method === 'fiado')) {
    return res.status(403).json({ error: 'El cajero no puede vender a crédito/fiado' });
  }

  if (payments.some(p => p.method === 'credit' || p.method === 'fiado')) {
    if (!customer_id) {
      return res.status(400).json({ error: 'Debe seleccionar un cliente para vender a crédito/fiado' });
    }
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(customer_id);
    if (!customer) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const creditAmount = payments.filter(p => p.method === 'credit' || p.method === 'fiado').reduce((sum, p) => sum + (p.amount || 0), 0);
    if (customer.credit_limit > 0 && customer.balance + creditAmount > customer.credit_limit) {
      const available = Math.max(0, customer.credit_limit - customer.balance);
      return res.status(400).json({ error: `Límite de crédito excedido para ${customer.name}. Disponible: $${available.toFixed(2)}` });
    }
  }

  const total = subtotal - globalDiscount;
  let totalPayments = 0;
  for (const p of payments) {
    totalPayments += p.amount || 0;
  }

  // Los pagos deben cubrir el total. Antes totalPayments se calculaba y NUNCA
  // se validaba: se podían registrar ventas con pagos que no cuadraban.
  // El excedente solo es válido si hay efectivo (es el cambio del cliente).
  const EPS = 0.01;
  if (totalPayments < total - EPS) {
    return res.status(400).json({ error: 'Los pagos no cubren el total de la venta' });
  }
  const hasCash = payments.some(p => p.method === 'cash');
  if (!hasCash && totalPayments > total + EPS) {
    return res.status(400).json({ error: 'El pago excede el total (solo se da cambio en pagos con efectivo)' });
  }
  const totalCredit = payments.filter(p => p.method === 'credit' || p.method === 'fiado').reduce((sum, p) => sum + p.amount, 0);
  if (totalCredit > total + EPS) {
    return res.status(400).json({ error: 'El monto a fiado no puede exceder el total de la venta' });
  }

  const cashNet = computeCashNet(payments, total);

  const today = businessToday();
  const register = db.prepare("SELECT * FROM cash_register WHERE date = ? AND status = 'open'").get(today);
  if (!register && cashNet > 0) {
    db.prepare(
      'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, 0, ?, ?, datetime("now"))'
    ).run(today, 'open', req.user.id);
  }

  const insertSale = db.prepare(
    `INSERT INTO sales (total, discount, payment_method, payment_details, customer_id, customer_name, status, created_by, created_by_name, client_id, client_created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`
  );

  const insertItem = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, discount, subtotal, is_individual, stock_delta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  const insertMovement = db.prepare(
    `INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by)
     VALUES (?, 'out', ?, ?, ?, 'sale', ?, ?, ?)`
  );

  const getStock = db.prepare('SELECT stock FROM products WHERE id = ?');

  const paymentMethods = payments.map(p => `${p.method}: $${p.amount.toFixed(2)}`).join(', ');

  const transaction = db.transaction(() => {
    const saleResult = insertSale.run(total, globalDiscount, paymentMethods, JSON.stringify(payments), customer_id || null, customer_name || null, req.user.id, req.user.name, client_id || null, client_created_at || null);
    const saleId = saleResult.lastInsertRowid;

    for (const item of items) {
      insertItem.run(saleId, item.product_id, item.product_name, item.barcode || null, item.quantity, item.unit_price, item.discount || 0, item.subtotal, item.is_individual ? 1 : 0, item.stock_delta);
      updateStock.run(item.stock_delta, item.product_id);
      const stockBefore = getStock.get(item.product_id).stock + item.stock_delta;
      const stockAfter = stockBefore - item.stock_delta;
      const notes = item.is_individual ? `Venta individual (${item.quantity} pza${item.quantity !== 1 ? 's' : ''})` : 'Venta realizada';
      insertMovement.run(item.product_id, item.stock_delta, stockBefore, stockAfter, saleId, notes, req.user.id);
    }

    if (customer_id) {
      if (payments.some(p => p.method === 'credit' || p.method === 'fiado')) {
        const creditAmount = payments.filter(p => p.method === 'credit' || p.method === 'fiado').reduce((sum, p) => sum + p.amount, 0);
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(creditAmount, customer_id);
        db.prepare(
          'INSERT INTO customer_payments (customer_id, sale_id, amount, payment_method, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(customer_id, saleId, -creditAmount, 'credit', `Venta a crédito #${saleId}`, req.user.id);
      }
    }

    // El movimiento de caja registra SOLO el efectivo neto que entró al
    // cajón, no el total de la venta: una venta pagada con tarjeta o fiado
    // no mete billetes al cajón, y antes se registraba el total completo —
    // por eso el "efectivo esperado" del corte salía inflado y la diferencia
    // parecía un faltante.
    const register = db.prepare("SELECT * FROM cash_register WHERE date = ? AND status = 'open'").get(today);
    if (register && cashNet > 0) {
      const itemsDesc = items.map(i => `${i.product_name} x${i.quantity}`).join(', ');
      const cashLabel = Math.abs(cashNet - total) > 0.009 ? ` (efectivo: $${cashNet.toFixed(2)})` : '';
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
         VALUES (?, 'sale', ?, ?, ?, 'sale', ?, ?, datetime("now"))`
      ).run(register.id, `Venta #${saleId} — ${itemsDesc} | Total: $${total.toFixed(2)}${cashLabel}`, cashNet, saleId, req.user.id, req.user.name || '');
    }

    return saleId;
  });

  try {
    const saleId = transaction();
    const sale = attachCustomerBalance(db, db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
    const saleItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    res.status(201).json({ sale, items: saleItems || [] });
  } catch (e) {
    res.status(500).json({ error: 'Error al procesar la venta: ' + e.message });
  }
});

router.get('/', authMiddleware, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const dateFrom = req.query.dateFrom || '';
  const dateTo = req.query.dateTo || '';
  const status = req.query.status || '';

  let where = 'WHERE 1=1';
  const params = [];

  if (dateFrom) { where += ` AND ${bizDate('s.created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { where += ` AND ${bizDate('s.created_at')} <= ?`; params.push(dateTo); }
  if (status) { where += ' AND s.status = ?'; params.push(status); }

  const countResult = db.prepare(`SELECT COUNT(*) as total FROM sales s ${where}`).get(...params);
  const sales = db.prepare(
    `SELECT s.* FROM sales s ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  for (const sale of sales) {
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  }

  res.json({ sales, total: countResult.total, page, limit, totalPages: Math.ceil(countResult.total / limit) });
});

router.get('/today', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();

  const sales = db.prepare(
    `SELECT s.* FROM sales s WHERE ${bizDate('s.created_at')} = ? AND s.status = 'completed' ORDER BY s.created_at DESC`
  ).all(today);

  for (const sale of sales) {
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  }

  const totals = db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total_sales FROM sales WHERE ${bizDate('created_at')} = ? AND status = 'completed'`
  ).get(today);

  res.json({ sales, totals });
});

router.get('/export', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo } = req.query;
  let where = "WHERE s.status = 'completed'";
  const params = [];
  if (dateFrom) { where += ` AND ${bizDate('s.created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { where += ` AND ${bizDate('s.created_at')} <= ?`; params.push(dateTo); }

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const offset = (page - 1) * limit;

  const countResult = db.prepare(
    `SELECT COUNT(*) as total FROM (SELECT DISTINCT s.id FROM sales s ${where})`
  ).get(...params);

  const sales = db.prepare(
    `SELECT s.*, u.name as created_by_name FROM sales s LEFT JOIN users u ON s.created_by = u.id ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const result = [];
  for (const sale of sales) {
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    for (const item of items) {
      result.push({
        id_venta: sale.id,
        fecha: new Date(sale.created_at).toLocaleDateString('es-MX'),
        hora: new Date(sale.created_at).toLocaleTimeString('es-MX'),
        cajero: sale.created_by_name || '',
        producto: item.product_name,
        cantidad: item.quantity,
        precio_unitario: item.unit_price,
        subtotal: item.subtotal,
        total_venta: sale.total,
        metodo_pago: sale.payment_method,
        cliente: sale.customer_name || '',
        descuento: sale.discount
      });
    }
  }

  res.json({ sales: result, total: countResult.total, page, limit });
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDB();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

  sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  res.json(attachCustomerBalance(db, sale));
});

// Solo admin: la cancelación revierte stock y devuelve efectivo del cajón —
// dejarla abierta a cualquier usuario autenticado era un vector de robo
// clásico en POS (vender, cobrar, cancelar y quedarse el efectivo). La UI ya
// ocultaba el botón a cajeros; esto lo hace obligatorio también en el API.
router.post('/:id/cancel', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Motivo de cancelación requerido' });

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  if (sale.status !== 'completed') return res.status(400).json({ error: 'La venta ya fue cancelada o devuelta' });

  const transaction = db.transaction(() => {
    db.prepare('UPDATE sales SET status = ?, cancel_reason = ? WHERE id = ?').run('cancelled', reason, req.params.id);

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(req.params.id);
    for (const item of items) {
      // stock_delta es lo que realmente se descontó al vender (puede ser una
      // fracción de paquete en venta individual); sale_items viejos de antes
      // de esta columna no la tienen, ahí sí corresponde revertir "quantity".
      const revertQty = item.stock_delta != null ? item.stock_delta : item.quantity;
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
      const stockBefore = product ? product.stock : 0;
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(revertQty, item.product_id);
      db.prepare(
        `INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by)
         VALUES (?, 'in', ?, ?, ?, 'cancellation', ?, ?, ?)`
      ).run(item.product_id, revertQty, stockBefore, stockBefore + revertQty, req.params.id, 'Cancelación de venta', req.user.id);
    }

    // Si la venta canceló crédito/fiado, revertir el saldo del cliente
    if (sale.customer_id) {
      const salePayments = sale.payment_details ? JSON.parse(sale.payment_details) : [];
      const creditAmount = salePayments.filter(p => p.method === 'credit' || p.method === 'fiado').reduce((sum, p) => sum + p.amount, 0);
      if (creditAmount > 0) {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(creditAmount, sale.customer_id);
        db.prepare(
          'INSERT INTO customer_payments (customer_id, sale_id, amount, payment_method, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(sale.customer_id, sale.id, creditAmount, 'credit', `Cancelación de venta a crédito #${sale.id}`, req.user.id);
      }
    }

    // El reembolso en efectivo sale del cajón de HOY (que es cuando el dinero
    // se devuelve físicamente), no del día de la venta original: insertar
    // movimientos en un corte ya cerrado alteraba silenciosamente cortes
    // históricos sin recalcular nada. Y solo se refleja la parte que entró en
    // efectivo — cancelar una venta con tarjeta no saca billetes del cajón.
    let refundCash = sale.total;
    try {
      const salePayments = sale.payment_details ? JSON.parse(sale.payment_details) : [];
      if (Array.isArray(salePayments) && salePayments.length > 0) {
        refundCash = computeCashNet(salePayments, sale.total);
      }
    } catch (e) {}
    if (refundCash > 0) {
      const today = businessToday();
      let register = db.prepare("SELECT * FROM cash_register WHERE date = ? AND status = 'open'").get(today);
      if (!register) {
        const ins = db.prepare(
          'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, 0, ?, ?, datetime("now"))'
        ).run(today, 'open', req.user.id);
        register = db.prepare('SELECT * FROM cash_register WHERE id = ?').get(ins.lastInsertRowid);
      }
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
         VALUES (?, 'return', ?, ?, ?, 'sale_cancel', ?, ?, datetime("now"))`
      ).run(register.id, `Cancelación de venta #${sale.id} — ${reason}`, -refundCash, sale.id, req.user.id, req.user.name || '');
    }
  });

  try {
    transaction();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/ticket/:id', authMiddleware, (req, res) => {
  const db = getDB();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  res.json(attachCustomerBalance(db, sale));
});

module.exports = router;
