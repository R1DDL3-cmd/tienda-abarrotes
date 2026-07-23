const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { predictProduct, predictAll, predictByCategory, getExecutiveSummary } = require('../services/predictions');
const { businessToday, businessNow, bizDate } = require('../bizdate');

const router = express.Router();

// Efectivo que DEBERÍA haber en el cajón: apertura + solo los movimientos que
// mueven billetes de verdad. Antes el esperado era "apertura + TODAS las
// ventas − TODOS los gastos", que trataba tarjeta/transferencia/fiado como si
// fueran efectivo e ignoraba por completo los retiros y los abonos de
// clientes — por eso el corte casi nunca cuadraba.
//
// Se calcula desde cash_movements (que desde esta versión registran solo el
// efectivo neto por venta, ver routes/sales.js). Se excluyen los movimientos
// de merma ('waste' y 'return' con reference_type='waste'): son pérdida de
// mercancía, no dinero que salga del cajón.
function computeExpectedCash(db, register) {
  const t = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'sale' THEN amount END), 0) AS sales_cash,
       COALESCE(SUM(CASE WHEN type = 'payment' THEN amount END), 0) AS customer_payments_cash,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses_cash,
       COALESCE(SUM(CASE WHEN type = 'return' AND reference_type = 'sale_cancel' THEN amount END), 0) AS sale_refunds,
       COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount END), 0) AS withdrawals,
       COALESCE(SUM(CASE WHEN type = 'cancel_withdrawal' THEN amount END), 0) AS cancelled_withdrawals
     FROM cash_movements WHERE cash_register_id = ?`
  ).get(register.id);

  // sale_refunds ya viene con signo negativo (se inserta como -efectivo devuelto)
  const expected = (register.opening_amount || 0)
    + t.sales_cash
    + t.customer_payments_cash
    + t.sale_refunds
    - t.expenses_cash
    - (t.withdrawals - t.cancelled_withdrawals);

  return { expected: Math.round(expected * 100) / 100, breakdown: t };
}

router.get('/dashboard', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();
  const now = businessNow();
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);

  const todaySales = db.prepare(
    `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE ${bizDate('created_at')} = ? AND status = 'completed'`
  ).get(today);

  const weekSales = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE ${bizDate('created_at')} >= ? AND status = 'completed'`
  ).get(weekAgo.toISOString().split('T')[0]);

  const monthSales = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE ${bizDate('created_at')} >= ? AND status = 'completed'`
  ).get(monthAgo.toISOString().split('T')[0]);

  const todayExpenses = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE ${bizDate('created_at')} = ?`
  ).get(today);

  const lowStockCount = db.prepare(
    'SELECT COUNT(*) as count FROM products WHERE active = 1 AND stock <= min_stock'
  ).get();

  const productsSold = db.prepare(
    `SELECT si.product_name, SUM(si.quantity) as total_qty, SUM(si.subtotal) as total_revenue
     FROM sale_items si JOIN sales s ON si.sale_id = s.id
     WHERE ${bizDate('s.created_at')} >= ? AND s.status = 'completed'
     GROUP BY si.product_id ORDER BY total_qty DESC LIMIT 10`
  ).all(monthAgo.toISOString().split('T')[0]);

  const dailySales = db.prepare(
    `SELECT ${bizDate('created_at')} as date, COUNT(*) as count, SUM(total) as total
     FROM sales WHERE ${bizDate('created_at')} >= ? AND status = 'completed'
     GROUP BY ${bizDate('created_at')} ORDER BY date ASC`
  ).all(monthAgo.toISOString().split('T')[0]);

  res.json({
    todaySales: { count: todaySales.count, total: todaySales.total },
    weekSales: weekSales.total,
    monthSales: monthSales.total,
    todayExpenses: todayExpenses.total,
    lowStockCount: lowStockCount.count,
    productsSold,
    dailySales
  });
});

router.get('/cash-register', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();
  let register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);

  const todaySales = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE ${bizDate('created_at')} = ? AND status = 'completed'`
  ).get(today);

  const salesByUser = db.prepare(
    `SELECT COALESCE(u.name, 'Usuario') as name, COALESCE(SUM(s.total), 0) as total, COUNT(s.id) as count
     FROM sales s LEFT JOIN users u ON s.created_by = u.id
     WHERE ${bizDate('s.created_at')} = ? AND s.status = 'completed'
     GROUP BY s.created_by ORDER BY total DESC`
  ).all(today);

  const todayExpenses = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE ${bizDate('created_at')} = ?`
  ).get(today);

  if (!register) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    db.prepare(
      'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, 0, ?, ?, datetime("now"))'
    ).run(today, 'open', admin ? admin.id : 1);
    register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
  }
  // expectedCash: el efectivo que debería haber en el cajón AHORA. Solo lo ve
  // el ADMIN — corte ciego: el cajero cuenta el dinero sin conocer el
  // esperado (estándar antifraude: si sabe cuánto "debe" haber, puede
  // cuadrar el faltante antes de reportarlo). El sistema guarda la
  // diferencia de todos modos y el dueño la revisa en Contabilidad.
  const payload = { ...register, totalSales: todaySales.total, salesByUser, totalExpenses: todayExpenses.total };
  if (req.user.role === 'admin') {
    const { expected } = computeExpectedCash(db, register);
    payload.expectedCash = expected;
  }
  res.json(payload);
});

router.put('/cash-register', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();
  let { opening_amount, closing_amount, notes } = req.body;
  const userName = req.user.name || '';

  // El conteo de un cajón físico nunca es negativo ni "abc": validar aquí
  // evita que un error de captura corrompa el corte con NaN o montos absurdos.
  if (opening_amount !== undefined) {
    opening_amount = Number(opening_amount);
    if (!Number.isFinite(opening_amount) || opening_amount < 0) {
      return res.status(400).json({ error: 'Monto de apertura inválido' });
    }
  }
  if (closing_amount !== undefined) {
    closing_amount = Number(closing_amount);
    if (!Number.isFinite(closing_amount) || closing_amount < 0) {
      return res.status(400).json({ error: 'Monto de cierre inválido' });
    }
  }

  const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
  if (!register) {
    const ins = db.prepare(
      'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, ?, ?, ?, datetime("now"))'
    );
    const result = ins.run(today, opening_amount || 0, 'open', req.user.id);
    db.prepare(
      `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
       VALUES (?, 'opening', ?, ?, 'cash_register', ?, ?, datetime("now"))`
    ).run(result.lastInsertRowid, `Apertura de caja — $${parseFloat(opening_amount || 0).toFixed(2)} por ${userName}`, opening_amount || 0, req.user.id, userName);
  } else if (closing_amount !== undefined) {
    // Totales del día (todos los métodos de pago) — informativos, para el
    // historial. El esperado del cajón se calcula aparte, solo con efectivo.
    const todaySales = db.prepare(
      `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE ${bizDate('created_at')} = ? AND status = 'completed'`
    ).get(today);
    const todayExpenses = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE ${bizDate('created_at')} = ?`
    ).get(today);
    const { expected } = computeExpectedCash(db, register);
    const difference = closing_amount - expected;
    db.prepare(
      'UPDATE cash_register SET closing_amount = ?, expected_amount = ?, difference = ?, total_sales = ?, total_expenses = ?, status = ?, closed_by = ?, closed_at = datetime("now"), notes = ? WHERE id = ?'
    ).run(closing_amount, expected, difference, todaySales.total, todayExpenses.total, 'closed', req.user.id, notes || null, register.id);
    db.prepare(
      `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
       VALUES (?, 'closing', ?, ?, 'cash_register', ?, ?, datetime("now"))`
    ).run(register.id, `Cierre de caja — $${parseFloat(closing_amount).toFixed(2)} (esperado: $${expected.toFixed(2)}, diferencia: $${difference.toFixed(2)}) por ${userName}`, closing_amount, req.user.id, userName);
  } else {
    db.prepare('UPDATE cash_register SET opening_amount = ?, opened_by = ? WHERE id = ?').run(opening_amount, req.user.id, register.id);
    if (parseFloat(opening_amount) > 0 && parseFloat(register.opening_amount) === 0) {
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
         VALUES (?, 'opening', ?, ?, 'cash_register', ?, ?, datetime("now"))`
      ).run(register.id, `Apertura de caja — $${parseFloat(opening_amount).toFixed(2)} por ${userName}`, opening_amount, req.user.id, userName);
    }
  }

  const updated = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
  res.json(updated);
});

router.get('/history', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo } = req.query;
  const params = [];
  let salesWhere = "status = 'completed'";
  let expWhere = '';
  if (dateFrom) { salesWhere += ` AND ${bizDate('created_at')} >= ?`; expWhere += ` AND ${bizDate('created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { salesWhere += ` AND ${bizDate('created_at')} <= ?`; expWhere += ` AND ${bizDate('created_at')} <= ?`; params.push(dateTo); }

  const sales = db.prepare(
    `SELECT ${bizDate('created_at')} as date, COUNT(*) as count, SUM(total) as total
     FROM sales WHERE ${salesWhere}
     GROUP BY ${bizDate('created_at')} ORDER BY date DESC`
  ).all(...params);

  const expenses = db.prepare(
    `SELECT ${bizDate('created_at')} as date, COUNT(*) as count, SUM(amount) as total
     FROM expenses${expWhere ? ' WHERE ' + expWhere.substring(4) : ''}
     GROUP BY ${bizDate('created_at')} ORDER BY date DESC`
  ).all(...params);

  const regParams = [];
  let regWhere = "status = 'closed'";
  if (dateFrom) { regWhere += ' AND date >= ?'; regParams.push(dateFrom); }
  // dateTo faltaba: al filtrar un rango, los cortes posteriores al rango se
  // colaban igual en el reporte.
  if (dateTo) { regWhere += ' AND date <= ?'; regParams.push(dateTo); }
  const registers = db.prepare(
    `SELECT * FROM cash_register WHERE ${regWhere} ORDER BY date DESC`
  ).all(...regParams);

  res.json({ sales, expenses, registers });
});

router.get('/expenses', authMiddleware, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const dateFrom = req.query.dateFrom || '';
  const dateTo = req.query.dateTo || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (dateFrom) { where += ` AND ${bizDate('created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { where += ` AND ${bizDate('created_at')} <= ?`; params.push(dateTo); }

  const countResult = db.prepare(`SELECT COUNT(*) as total FROM expenses ${where}`).get(...params);
  const expenses = db.prepare(
    `SELECT e.*, u.name as created_by_name FROM expenses e LEFT JOIN users u ON e.created_by = u.id ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ expenses, total: countResult.total, page, limit });
});

router.post('/expenses', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { description, amount, category, payment_method, notes } = req.body;
    if (!description) return res.status(400).json({ error: 'Descripción requerida' });
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Monto inválido' });
    const result = db.prepare(
      'INSERT INTO expenses (description, amount, category, payment_method, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(description, parseFloat(amount), category || null, payment_method || 'cash', notes || null, req.user.id);
    let expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
    if (!expense && result.lastInsertRowid === 0) {
      expense = db.prepare('SELECT * FROM expenses ORDER BY id DESC LIMIT 1').get();
    }
    if (!expense) return res.status(500).json({ error: 'Error al recuperar el gasto' });

    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
    const today = businessToday();
    const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
    // Solo los gastos pagados en efectivo sacan billetes del cajón; un gasto
    // con tarjeta/transferencia no debe afectar el efectivo esperado del corte.
    const method = payment_method || 'cash';
    if (register && method === 'cash') {
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
         VALUES (?, 'expense', ?, ?, ?, 'expense', ?, ?, datetime("now"))`
      ).run(register.id, `Gasto — ${description} (${category || 'Sin categoría'})`, parseFloat(amount), expense.id, req.user.id, user?.name || '');
    }

    res.status(201).json(expense);
  } catch (e) {
    console.error('Error creating expense:', e);
    res.status(500).json({ error: 'Error al crear gasto: ' + e.message });
  }
});

router.delete('/expenses/:id', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });

  // Borrar el gasto sin quitar su movimiento de caja dejaba el efectivo
  // esperado del corte desalineado para siempre. Los gastos generados por una
  // compra a proveedor registran su movimiento con reference_type='purchase'.
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    if (expense.reference_type === 'purchase' && expense.reference_id) {
      db.prepare("DELETE FROM cash_movements WHERE type = 'expense' AND reference_type = 'purchase' AND reference_id = ?").run(expense.reference_id);
    } else {
      db.prepare("DELETE FROM cash_movements WHERE type = 'expense' AND reference_type = 'expense' AND reference_id = ?").run(expense.id);
    }
  });

  try {
    transaction();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar gasto: ' + e.message });
  }
});

router.get('/top-products', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo, limit: qLimit = 20 } = req.query;
  let where = "WHERE s.status = 'completed'";
  const params = [];
  if (dateFrom) { where += ` AND ${bizDate('s.created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { where += ` AND ${bizDate('s.created_at')} <= ?`; params.push(dateTo); }

  const products = db.prepare(
    `SELECT si.product_name, SUM(si.quantity) as total_qty, SUM(si.subtotal) as total_revenue
     FROM sale_items si JOIN sales s ON si.sale_id = s.id
     ${where}
     GROUP BY si.product_id ORDER BY total_qty DESC LIMIT ?`
  ).all(...params, parseInt(qLimit));
  res.json({ products });
});

router.get('/profit', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { dateFrom, dateTo } = req.query;
    const params = [];
    let salesWhere = "s.status = 'completed'";
    let expWhere = '';
    if (dateFrom) { salesWhere += ` AND ${bizDate('s.created_at')} >= ?`; expWhere += ` AND ${bizDate('created_at')} >= ?`; params.push(dateFrom); }
    if (dateTo) { salesWhere += ` AND ${bizDate('s.created_at')} <= ?`; expWhere += ` AND ${bizDate('created_at')} <= ?`; params.push(dateTo); }

    const revenue = db.prepare(`SELECT COALESCE(SUM(total), 0) as total FROM sales s WHERE ${salesWhere}`).get(...params);
    // Una venta individual (ej. cigarros sueltos) vende PIEZAS, pero
    // purchase_price es el costo del PAQUETE completo — hay que prorratear
    // el costo entre las unidades del paquete, si no el costo de una sola
    // pieza se calcularía como si fuera el paquete entero.
    const cost = db.prepare(
      `SELECT COALESCE(SUM(
         si.quantity * CASE
           WHEN si.is_individual = 1 AND p.units_per_package > 0 THEN COALESCE(p.purchase_price, 0) * 1.0 / p.units_per_package
           ELSE COALESCE(p.purchase_price, 0)
         END
       ), 0) as total
       FROM sale_items si JOIN sales s ON si.sale_id = s.id
       LEFT JOIN products p ON si.product_id = p.id
       WHERE ${salesWhere}`
    ).get(...params);
    const expensesResult = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses${expWhere ? ' WHERE ' + expWhere : ''}`
    ).get(...params);

    res.json({
      revenue: revenue.total,
      cost: cost.total,
      grossProfit: revenue.total - cost.total,
      expenses: expensesResult.total,
      netProfit: revenue.total - cost.total - expensesResult.total
    });
  } catch (e) {
    console.error('Error getting profit:', e);
    res.status(500).json({ error: 'Error al calcular ganancias: ' + e.message });
  }
});

// Utilidad por producto o por categoría: qué deja dinero y qué no. Usa el
// mismo prorrateo de venta individual que /profit (una pieza suelta cuesta
// una fracción del paquete, no el paquete entero). Solo admin: expone
// márgenes y costos del negocio.
router.get('/profit-by-product', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { dateFrom, dateTo, groupBy } = req.query;
    const params = [];
    let where = "s.status = 'completed'";
    if (dateFrom) { where += ` AND ${bizDate('s.created_at')} >= ?`; params.push(dateFrom); }
    if (dateTo) { where += ` AND ${bizDate('s.created_at')} <= ?`; params.push(dateTo); }

    const costExpr = `si.quantity * CASE
      WHEN si.is_individual = 1 AND p.units_per_package > 0 THEN COALESCE(p.purchase_price, 0) * 1.0 / p.units_per_package
      ELSE COALESCE(p.purchase_price, 0)
    END`;

    let rows;
    if (groupBy === 'category') {
      rows = db.prepare(
        `SELECT COALESCE(p.category_name, 'Sin categoría') AS name,
                SUM(si.quantity) AS qty_sold,
                SUM(si.subtotal) AS revenue,
                SUM(${costExpr}) AS cost
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         WHERE ${where}
         GROUP BY COALESCE(p.category_name, 'Sin categoría')`
      ).all(...params);
    } else {
      rows = db.prepare(
        `SELECT si.product_id, si.product_name AS name,
                COALESCE(p.category_name, 'Sin categoría') AS category_name,
                SUM(si.quantity) AS qty_sold,
                SUM(si.subtotal) AS revenue,
                SUM(${costExpr}) AS cost
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         LEFT JOIN products p ON si.product_id = p.id
         WHERE ${where}
         GROUP BY si.product_id`
      ).all(...params);
    }

    const result = rows.map(r => {
      const profit = (r.revenue || 0) - (r.cost || 0);
      return {
        ...r,
        profit: Math.round(profit * 100) / 100,
        margin_pct: r.revenue > 0 ? Math.round((profit / r.revenue) * 10000) / 100 : null,
      };
    }).sort((a, b) => b.profit - a.profit);

    res.json({ rows: result });
  } catch (e) {
    res.status(500).json({ error: 'Error calculando utilidad: ' + e.message });
  }
});

router.get('/cash-movements', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo, type, limit: qLimit = 100 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (dateFrom) { where += ` AND ${bizDate('cm.created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { where += ` AND ${bizDate('cm.created_at')} <= ?`; params.push(dateTo); }
  if (type) { where += ' AND cm.type = ?'; params.push(type); }
  const movements = db.prepare(
    `SELECT cm.*, cr.date as register_date FROM cash_movements cm
     LEFT JOIN cash_register cr ON cm.cash_register_id = cr.id
     ${where} ORDER BY cm.created_at DESC LIMIT ?`
  ).all(...params, parseInt(qLimit));
  res.json({ movements });
});

router.post('/product-waste', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { product_id, quantity, unit_type, reason, waste_type, notes } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Producto requerido' });
    if (!quantity || parseFloat(quantity) <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Motivo obligatorio' });
    if (!waste_type || !['waste', 'return_to_supplier'].includes(waste_type)) return res.status(400).json({ error: 'Tipo de merma inválido' });

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    if (product.stock < parseFloat(quantity)) return res.status(400).json({ error: 'Stock insuficiente' });

    const total_loss = parseFloat(quantity) * parseFloat(product.purchase_price || product.sale_price || 0);
    const stockBefore = product.stock;
    const stockAfter = product.stock - parseFloat(quantity);

    const transaction = db.transaction(() => {
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(parseFloat(quantity), product_id);
      const result = db.prepare(
        'INSERT INTO product_waste (product_id, quantity, unit_type, reason, waste_type, total_loss, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(product_id, parseFloat(quantity), unit_type || product.unit_type || null, reason.trim(), waste_type, total_loss, notes || null, req.user.id);
      db.prepare(
        `INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by)
         VALUES (?, 'out', ?, ?, ?, 'waste', ?, ?, ?)`
      ).run(product_id, parseFloat(quantity), stockBefore, stockAfter, result.lastInsertRowid, notes || reason.trim(), req.user.id);

      const today = businessToday();
      const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
      if (register) {
        db.prepare(
          `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
           VALUES (?, ?, ?, ?, ?, 'waste', ?, ?, datetime("now"))`
        ).run(register.id, waste_type === 'return_to_supplier' ? 'return' : 'waste',
          `${waste_type === 'return_to_supplier' ? 'Devolución a proveedor' : 'Merma'} — ${product.name} x${parseFloat(quantity)} (${reason.trim()})`,
          total_loss, result.lastInsertRowid, req.user.id, req.user.name || '');
      }
    });
    transaction();
    res.status(201).json({ success: true, total_loss });
  } catch (e) {
    console.error('Error creating waste:', e);
    res.status(500).json({ error: 'Error al registrar merma: ' + e.message });
  }
});

router.get('/product-waste', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo, waste_type, limit: qLimit = 50 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (dateFrom) { where += ` AND ${bizDate('pw.created_at')} >= ?`; params.push(dateFrom); }
  if (dateTo) { where += ` AND ${bizDate('pw.created_at')} <= ?`; params.push(dateTo); }
  if (waste_type) { where += ' AND pw.waste_type = ?'; params.push(waste_type); }
  const waste = db.prepare(
    `SELECT pw.*, p.name as product_name, p.barcode, u.name as created_by_name
     FROM product_waste pw LEFT JOIN products p ON pw.product_id = p.id
     LEFT JOIN users u ON pw.created_by = u.id
     ${where} ORDER BY pw.created_at DESC LIMIT ?`
  ).all(...params, parseInt(qLimit));
  res.json({ waste });
});

// Session endpoints (per-user cash handover)
router.get('/my-session', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();
  const session = db.prepare(
    "SELECT * FROM cash_sessions WHERE date = ? AND user_id = ? AND status = 'open'"
  ).get(today, req.user.id);
  res.json({ session: session || null });
});

router.post('/sessions', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();
  const { opening_amount } = req.body;

  // Close any existing open session for this user today
  db.prepare(
    "UPDATE cash_sessions SET status = 'closed', closed_at = datetime('now'), closing_amount = 0 WHERE date = ? AND user_id = ? AND status = 'open'"
  ).run(today, req.user.id);

  // Create new session
  const result = db.prepare(
    "INSERT INTO cash_sessions (date, user_id, user_name, opening_amount, opened_at, status) VALUES (?, ?, ?, ?, datetime('now'), 'open')"
  ).run(today, req.user.id, req.user.name || '', opening_amount || 0);

  // Record opening cash_movement
  const register = db.prepare("SELECT id FROM cash_register WHERE date = ?").get(today);
  if (register) {
    try {
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, session_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
         VALUES (?, ?, 'opening', ?, ?, 'session', ?, ?, datetime('now'))`
      ).run(register.id, result.lastInsertRowid, `Apertura de turno — $${parseFloat(opening_amount || 0).toFixed(2)} por ${req.user.name || ''}`, opening_amount || 0, req.user.id, req.user.name || '');
    } catch (e) {
      try {
        db.prepare(
          `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
           VALUES (?, 'opening', ?, ?, 'session', ?, ?, datetime('now'))`
        ).run(register.id, `Apertura de turno — $${parseFloat(opening_amount || 0).toFixed(2)} por ${req.user.name || ''}`, opening_amount || 0, req.user.id, req.user.name || '');
      } catch (_) {}
    }
  }

  const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(result.lastInsertRowid);
  res.json({ session });
});

router.put('/sessions/:id/close', authMiddleware, (req, res) => {
  const db = getDB();
  const { closing_amount } = req.body;
  const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  // Cada quien cierra SU turno (o el admin cualquiera): antes cualquier
  // usuario podía cerrar la sesión de caja de otro con cualquier monto.
  if (session.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo puedes cerrar tu propio turno' });
  }

  db.prepare(
    "UPDATE cash_sessions SET status = 'closed', closed_at = datetime('now'), closing_amount = ? WHERE id = ?"
  ).run(closing_amount || 0, req.params.id);

  const register = db.prepare("SELECT id FROM cash_register WHERE date = ?").get(session.date);
  if (register) {
    try {
      db.prepare(
        `INSERT INTO cash_movements (cash_register_id, session_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
         VALUES (?, ?, 'closing', ?, ?, 'session', ?, ?, datetime('now'))`
      ).run(register.id, req.params.id, `Cierre de turno — $${parseFloat(closing_amount || 0).toFixed(2)} por ${req.user.name || ''}`, closing_amount || 0, req.user.id, req.user.name || '');
    } catch (e) {
      // fallback: insert without session_id if column doesn't exist
      try {
        db.prepare(
          `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
           VALUES (?, 'closing', ?, ?, 'session', ?, ?, datetime('now'))`
        ).run(register.id, `Cierre de turno — $${parseFloat(closing_amount || 0).toFixed(2)} por ${req.user.name || ''}`, closing_amount || 0, req.user.id, req.user.name || '');
      } catch (_) {}
    }
  }

  res.json({ success: true });
});

// Withdrawal endpoints
router.get('/withdrawals', authMiddleware, (req, res) => {
  const db = getDB();
  const today = businessToday();
  const withdrawals = db.prepare(
    `SELECT * FROM cash_movements WHERE type = 'withdrawal' AND ${bizDate('created_at')} = ? ORDER BY created_at DESC`
  ).all(today);
  res.json({ withdrawals });
});

router.post('/withdrawals', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { amount, reason } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Motivo obligatorio' });
    const today = businessToday();
    const register = db.prepare("SELECT id FROM cash_register WHERE date = ?").get(today);
    if (!register) return res.status(400).json({ error: 'No hay caja abierta hoy' });
    const result = db.prepare(
      `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_type, created_by, created_by_name, created_at)
       VALUES (?, 'withdrawal', ?, ?, 'withdrawal', ?, ?, datetime('now'))`
    ).run(register.id, `Retiro de efectivo — $${parseFloat(amount).toFixed(2)} — ${reason.trim()}`, parseFloat(amount), req.user.id, req.user.name || '');
    const movement = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(movement);
  } catch (e) {
    res.status(500).json({ error: 'Error al registrar retiro: ' + e.message });
  }
});

// Solo admin: cancelar un retiro "regresa" efectivo al esperado del corte —
// en manos de cualquier usuario permitía maquillar faltantes.
router.put('/withdrawals/:id/cancel', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = getDB();
    const original = db.prepare("SELECT * FROM cash_movements WHERE id = ? AND type = 'withdrawal'").get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Retiro no encontrado' });
    const alreadyCancelled = db.prepare(
      "SELECT id FROM cash_movements WHERE type = 'cancel_withdrawal' AND reference_id = ?"
    ).get(original.id);
    if (alreadyCancelled) return res.status(400).json({ error: 'Este retiro ya fue cancelado' });
    const today = businessToday();
    const register = db.prepare("SELECT id FROM cash_register WHERE date = ?").get(today);
    if (!register) return res.status(400).json({ error: 'No hay caja abierta hoy' });
    const result = db.prepare(
      `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
       VALUES (?, 'cancel_withdrawal', ?, ?, ?, 'withdrawal_cancel', ?, ?, datetime('now'))`
    ).run(register.id, `Cancelación de retiro #${original.id} — $${parseFloat(original.amount).toFixed(2)} — ${original.description}`, parseFloat(original.amount), original.id, req.user.id, req.user.name || '');
    const movement = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(result.lastInsertRowid);
    res.json(movement);
  } catch (e) {
    res.status(500).json({ error: 'Error al cancelar retiro: ' + e.message });
  }
});

// ============================================================
// Nexo Systems — Endpoints de Prediccion
// ============================================================

router.get('/predictions', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const summary = getExecutiveSummary(db);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: 'Error generando predicciones: ' + e.message });
  }
});

router.get('/predictions/products', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const predictions = predictAll(db);
    res.json({ predictions });
  } catch (e) {
    res.status(500).json({ error: 'Error generando predicciones: ' + e.message });
  }
});

router.get('/predictions/categories', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const categories = predictByCategory(db);
    res.json({ categories });
  } catch (e) {
    res.status(500).json({ error: 'Error generando predicciones por categoria: ' + e.message });
  }
});

router.get('/predictions/:productId', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const prediction = predictProduct(parseInt(req.params.productId), db);
    if (!prediction) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(prediction);
  } catch (e) {
    res.status(500).json({ error: 'Error generando prediccion: ' + e.message });
  }
});

// ============================================================
// RECOMENDACION DE COMPRA
// ============================================================
router.get('/recommendation/:productId', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    const pred = predictProduct(parseInt(req.params.productId), db);
    if (!pred) return res.status(404).json({ error: 'No se pudo generar prediccion' });

    res.json({
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      supplier: product.supplier || 'Sin proveedor',
      current_stock: product.stock,
      min_stock: product.min_stock,
      daily_forecast: pred.daily_forecast,
      weekly_forecast: pred.weekly_forecast,
      days_until_stockout: pred.days_until_stockout,
      safety_stock: pred.safety_stock,
      reorder_point: pred.reorder_point,
      suggested_order: pred.suggested_order,
      suggested_date: new Date(Date.now() + Math.ceil(pred.days_until_stockout * 0.7) * 86400000).toISOString().split('T')[0],
      demand_type: pred.demand_type,
      ci_lower: pred.ci_lower,
      ci_upper: pred.ci_upper,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error generando recomendacion: ' + e.message });
  }
});

// ============================================================
// RIESGO DE FALTANTE / SOBREINVENTARIO
// ============================================================
router.get('/risk', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const filter = req.query.filter || 'all'; // stockout | overstock | all
    const predictions = predictAll(db);

    const stockoutRisk = predictions
      .filter(p => p.days_until_stockout < 14)
      .map(p => ({
        product_id: p.product_id,
        product_name: p.product_name,
        current_stock: p.current_stock,
        daily_forecast: p.daily_forecast,
        days_until_stockout: p.days_until_stockout,
        risk_level: p.days_until_stockout < 3 ? 'critico' : p.days_until_stockout < 7 ? 'alto' : 'medio',
        suggested_order: p.suggested_order,
      }))
      .sort((a, b) => a.days_until_stockout - b.days_until_stockout);

    const overstockRisk = predictions
      .filter(p => p.current_stock > p.monthly_forecast * 2 && p.monthly_forecast > 0)
      .map(p => ({
        product_id: p.product_id,
        product_name: p.product_name,
        current_stock: p.current_stock,
        monthly_forecast: p.monthly_forecast,
        months_of_stock: p.current_stock / p.monthly_forecast,
        risk_level: p.current_stock / p.monthly_forecast > 6 ? 'critico' : 'alto',
      }))
      .sort((a, b) => b.months_of_stock - a.months_of_stock);

    if (filter === 'stockout') return res.json({ risk_type: 'stockout', products: stockoutRisk });
    if (filter === 'overstock') return res.json({ risk_type: 'overstock', products: overstockRisk });

    res.json({
      stockout: { count: stockoutRisk.length, products: stockoutRisk },
      overstock: { count: overstockRisk.length, products: overstockRisk },
    });
  } catch (e) {
    res.status(500).json({ error: 'Error calculando riesgos: ' + e.message });
  }
});

// ============================================================
// RETROALIMENTACION DE VENTAS REALES (para reentrenamiento)
// ============================================================
router.post('/predictions/feedback', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { product_id, predicted_qty, actual_qty, forecast_date } = req.body;
    if (!product_id || actual_qty === undefined || !forecast_date) {
      return res.status(400).json({ error: 'product_id, actual_qty y forecast_date son obligatorios' });
    }
    const pred = db.prepare('SELECT * FROM prediction_feedback WHERE product_id = ? AND forecast_date = ?').get(product_id, forecast_date);
    if (pred) {
      db.prepare('UPDATE prediction_feedback SET predicted_qty = ?, actual_qty = ? WHERE id = ?').run(predicted_qty || pred.predicted_qty, actual_qty, pred.id);
    } else {
      db.prepare('INSERT INTO prediction_feedback (product_id, predicted_qty, actual_qty, forecast_date) VALUES (?, ?, ?, ?)').run(product_id, predicted_qty || 0, actual_qty, forecast_date);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error registrando retroalimentacion: ' + e.message });
  }
});

// ============================================================
// SALUD / ESTADO DEL MODELO
// ============================================================
router.get('/predictions/health', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE active = 1").get().count;
    const predictions = predictAll(db);

    // Precisión histórica (MAE promedio)
    const feedbacks = db.prepare(`
      SELECT pf.product_id, pf.predicted_qty, pf.actual_qty,
        (SELECT name FROM products WHERE id = pf.product_id) as product_name
      FROM prediction_feedback pf ORDER BY pf.created_at DESC LIMIT 100
    `).all();

    let totalError = 0; let errorCount = 0;
    const productErrors = [];
    for (const fb of feedbacks) {
      if (fb.actual_qty > 0) {
        const pctError = Math.abs(fb.actual_qty - fb.predicted_qty) / fb.actual_qty * 100;
        totalError += pctError;
        errorCount++;
        productErrors.push({ product_id: fb.product_id, product_name: fb.product_name, predicted_qty: fb.predicted_qty, actual_qty: fb.actual_qty, pct_error: Math.round(pctError * 100) / 100 });
      }
    }

    const avgAccuracy = errorCount > 0 ? Math.max(0, 100 - (totalError / errorCount)) : null;

    res.json({
      status: 'operational',
      last_generated: new Date().toISOString(),
      model_version: 'Nexo Systems Predictor v1.0',
      product_count: totalProducts,
      predicted_count: predictions.length,
      product_types: predictions.reduce((acc, p) => { acc[p.demand_type] = (acc[p.demand_type] || 0) + 1; return acc; }, {}),
      feedback_count: feedbacks.length,
      avg_accuracy: avgAccuracy !== null ? Math.round(avgAccuracy * 100) / 100 : null,
      recent_errors: productErrors.slice(0, 20),
      last_retrain: new Date().toISOString(),
      next_retrain: new Date(Date.now() + 86400000).toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: 'Error en health check: ' + e.message });
  }
});

module.exports = router;
