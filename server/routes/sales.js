const express = require('express');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/', authMiddleware, (req, res) => {
  const db = getDB();
  const { items, payments, discount = 0, customer_id, customer_name } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
  }

  if (!payments || payments.length === 0) {
    return res.status(400).json({ error: 'Debe especificar al menos un método de pago' });
  }

  const isCashier = req.user.role === 'cashier';

  let subtotal = 0;
  for (const item of items) {
    if (!item.product_id || !item.quantity || !item.unit_price) {
      return res.status(400).json({ error: 'Datos de producto incompletos' });
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (!product) {
      return res.status(404).json({ error: `Producto ID ${item.product_id} no encontrado` });
    }
    if (product.stock < item.quantity) {
      return res.status(400).json({ error: `Stock insuficiente para ${product.name}. Disponible: ${product.stock}` });
    }
    if (isCashier && item.unit_price !== product.sale_price) {
      item.unit_price = product.sale_price;
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

  if (isCashier && discount > 0) {
    return res.status(403).json({ error: 'El cajero no puede aplicar descuentos globales' });
  }

  if (isCashier && payments.some(p => p.method === 'credit' || p.method === 'fiado')) {
    return res.status(403).json({ error: 'El cajero no puede vender a crédito/fiado' });
  }

  if (payments.some(p => p.method === 'mixed')) {
    return res.status(400).json({ error: 'Método de pago inválido' });
  }

  const total = subtotal - discount;
  let totalPayments = 0;
  for (const p of payments) {
    totalPayments += p.amount || 0;
  }

  const today = new Date().toISOString().split('T')[0];
  const register = db.prepare("SELECT * FROM cash_register WHERE date = ? AND status = 'open'").get(today);
  if (!register && payments.some(p => p.method === 'cash')) {
    db.prepare(
      'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, 0, ?, ?, datetime("now"))'
    ).run(today, 'open', req.user.id);
  }

  const insertSale = db.prepare(
    `INSERT INTO sales (total, discount, payment_method, payment_details, customer_id, customer_name, status, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
  );

  const insertItem = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, discount, subtotal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  const insertMovement = db.prepare(
    `INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by)
     VALUES (?, 'out', ?, ?, ?, 'sale', ?, ?, ?)`
  );

  const getStock = db.prepare('SELECT stock FROM products WHERE id = ?');

  const paymentMethods = payments.map(p => `${p.method}: $${p.amount.toFixed(2)}`).join(', ');

  const transaction = db.transaction(() => {
    const saleResult = insertSale.run(total, discount, paymentMethods, JSON.stringify(payments), customer_id || null, customer_name || null, req.user.id, req.user.name);
    const saleId = saleResult.lastInsertRowid;

    for (const item of items) {
      insertItem.run(saleId, item.product_id, item.product_name, item.barcode || null, item.quantity, item.unit_price, item.discount || 0, item.subtotal);
      updateStock.run(item.quantity, item.product_id);
      const stockBefore = getStock.get(item.product_id).stock + item.quantity;
      const stockAfter = stockBefore - item.quantity;
      insertMovement.run(item.product_id, item.quantity, stockBefore, stockAfter, saleId, 'Venta realizada', req.user.id);
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

    const register = db.prepare("SELECT * FROM cash_register WHERE date = ? AND status = 'open'").get(today);
    if (register) {
      const itemsDesc = items.map(i => `${i.product_name} x${i.quantity}`).join(', ');
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
         VALUES (?, 'sale', ?, ?, ?, 'sale', ?, ?, datetime("now"))`
      ).run(register.id, `Venta #${saleId} — ${itemsDesc} | Total: $${total.toFixed(2)}`, total, saleId, req.user.id, req.user.name || '');
    }

    return saleId;
  });

  try {
    const saleId = transaction();
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
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

  if (dateFrom) { where += ' AND date(s.created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(s.created_at) <= ?'; params.push(dateTo); }
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
  const today = new Date().toISOString().split('T')[0];

  const sales = db.prepare(
    `SELECT s.* FROM sales s WHERE date(s.created_at) = ? AND s.status = 'completed' ORDER BY s.created_at DESC`
  ).all(today);

  for (const sale of sales) {
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  }

  const totals = db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total_sales FROM sales WHERE date(created_at) = ? AND status = 'completed'`
  ).get(today);

  res.json({ sales, totals });
});

router.get('/export', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo } = req.query;
  let where = "WHERE s.status = 'completed'";
  const params = [];
  if (dateFrom) { where += ' AND date(s.created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(s.created_at) <= ?'; params.push(dateTo); }

  const sales = db.prepare(
    `SELECT s.*, u.name as created_by_name FROM sales s LEFT JOIN users u ON s.created_by = u.id ${where} ORDER BY s.created_at DESC`
  ).all(...params);

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

  res.json({ sales: result });
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDB();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

  sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  res.json(sale);
});

router.post('/:id/cancel', authMiddleware, (req, res) => {
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
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
      const stockBefore = product ? product.stock : 0;
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
      db.prepare(
        `INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by)
         VALUES (?, 'in', ?, ?, ?, 'cancellation', ?, ?, ?)`
      ).run(item.product_id, item.quantity, stockBefore, stockBefore + item.quantity, req.params.id, 'Cancelación de venta', req.user.id);
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
  res.json(sale);
});

module.exports = router;
