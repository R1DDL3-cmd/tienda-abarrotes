const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { predictProduct, predictAll, predictByCategory, getExecutiveSummary } = require('../services/predictions');

const router = express.Router();

router.get('/dashboard', authMiddleware, (req, res) => {
  const db = getDB();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);

  const todaySales = db.prepare(
    "SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) = ? AND status = 'completed'"
  ).get(today);

  const weekSales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) >= ? AND status = 'completed'"
  ).get(weekAgo.toISOString().split('T')[0]);

  const monthSales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) >= ? AND status = 'completed'"
  ).get(monthAgo.toISOString().split('T')[0]);

  const todayExpenses = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(created_at) = ?"
  ).get(today);

  const lowStockCount = db.prepare(
    'SELECT COUNT(*) as count FROM products WHERE active = 1 AND stock <= min_stock'
  ).get();

  const productsSold = db.prepare(
    `SELECT si.product_name, SUM(si.quantity) as total_qty, SUM(si.subtotal) as total_revenue
     FROM sale_items si JOIN sales s ON si.sale_id = s.id
     WHERE date(s.created_at) >= ? AND s.status = 'completed'
     GROUP BY si.product_id ORDER BY total_qty DESC LIMIT 10`
  ).all(monthAgo.toISOString().split('T')[0]);

  const dailySales = db.prepare(
    `SELECT date(created_at) as date, COUNT(*) as count, SUM(total) as total
     FROM sales WHERE date(created_at) >= ? AND status = 'completed'
     GROUP BY date(created_at) ORDER BY date ASC`
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
  const today = new Date().toISOString().split('T')[0];
  const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);

  const todaySales = db.prepare(
    "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) = ? AND status = 'completed'"
  ).get(today);

  const salesByUser = db.prepare(
    `SELECT COALESCE(u.name, 'Usuario') as name, COALESCE(SUM(s.total), 0) as total, COUNT(s.id) as count
     FROM sales s LEFT JOIN users u ON s.created_by = u.id
     WHERE date(s.created_at) = ? AND s.status = 'completed'
     GROUP BY s.created_by ORDER BY total DESC`
  ).all(today);

  const todayExpenses = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(created_at) = ?"
  ).get(today);

  if (!register) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    db.prepare(
      'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, 0, ?, ?, datetime("now"))'
    ).run(today, 'open', admin ? admin.id : 1);
    const newReg = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
    return res.json({ ...newReg, totalSales: todaySales.total, salesByUser, totalExpenses: todayExpenses.total });
  }
  res.json({ ...register, totalSales: todaySales.total, salesByUser, totalExpenses: todayExpenses.total });
});

router.put('/cash-register', authMiddleware, (req, res) => {
  const db = getDB();
  const today = new Date().toISOString().split('T')[0];
  const { opening_amount, closing_amount, notes } = req.body;
  const userName = req.user.name || '';

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
    const todaySales = db.prepare(
      "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE date(created_at) = ? AND status = 'completed'"
    ).get(today);
    const todayExpenses = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(created_at) = ?"
    ).get(today);
    const expected = register.opening_amount + todaySales.total - todayExpenses.total;
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
  if (dateFrom) { salesWhere += ' AND date(created_at) >= ?'; expWhere += ' AND date(created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { salesWhere += ' AND date(created_at) <= ?'; expWhere += ' AND date(created_at) <= ?'; params.push(dateTo); }

  const sales = db.prepare(
    `SELECT date(created_at) as date, COUNT(*) as count, SUM(total) as total
     FROM sales WHERE ${salesWhere}
     GROUP BY date(created_at) ORDER BY date DESC`
  ).all(...params);

  const expenses = db.prepare(
    `SELECT date(created_at) as date, COUNT(*) as count, SUM(amount) as total
     FROM expenses${expWhere ? ' WHERE ' + expWhere.substring(4) : ''}
     GROUP BY date(created_at) ORDER BY date DESC`
  ).all(...params);

  const regParams = [];
  let regWhere = "status = 'closed'";
  if (dateFrom) { regWhere += ' AND date >= ?'; regParams.push(dateFrom); }
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
  if (dateFrom) { where += ' AND date(created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(created_at) <= ?'; params.push(dateTo); }

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
    const today = new Date().toISOString().split('T')[0];
    const register = db.prepare('SELECT * FROM cash_register WHERE date = ?').get(today);
    if (register) {
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
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/top-products', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo, limit: qLimit = 20 } = req.query;
  let where = "WHERE s.status = 'completed'";
  const params = [];
  if (dateFrom) { where += ' AND date(s.created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(s.created_at) <= ?'; params.push(dateTo); }

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
    if (dateFrom) { salesWhere += ' AND date(s.created_at) >= ?'; expWhere += ' AND date(created_at) >= ?'; params.push(dateFrom); }
    if (dateTo) { salesWhere += ' AND date(s.created_at) <= ?'; expWhere += ' AND date(created_at) <= ?'; params.push(dateTo); }

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

router.get('/cash-movements', authMiddleware, (req, res) => {
  const db = getDB();
  const { dateFrom, dateTo, type, limit: qLimit = 100 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (dateFrom) { where += ' AND date(cm.created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(cm.created_at) <= ?'; params.push(dateTo); }
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

      const today = new Date().toISOString().split('T')[0];
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
  if (dateFrom) { where += ' AND date(pw.created_at) >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(pw.created_at) <= ?'; params.push(dateTo); }
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
  const today = new Date().toISOString().split('T')[0];
  const session = db.prepare(
    "SELECT * FROM cash_sessions WHERE date = ? AND user_id = ? AND status = 'open'"
  ).get(today, req.user.id);
  res.json({ session: session || null });
});

router.post('/sessions', authMiddleware, (req, res) => {
  const db = getDB();
  const today = new Date().toISOString().split('T')[0];
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
  const today = new Date().toISOString().split('T')[0];
  const withdrawals = db.prepare(
    `SELECT * FROM cash_movements WHERE type = 'withdrawal' AND date(created_at) = ? ORDER BY created_at DESC`
  ).all(today);
  res.json({ withdrawals });
});

router.post('/withdrawals', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { amount, reason } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Motivo obligatorio' });
    const today = new Date().toISOString().split('T')[0];
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

router.put('/withdrawals/:id/cancel', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const original = db.prepare("SELECT * FROM cash_movements WHERE id = ? AND type = 'withdrawal'").get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Retiro no encontrado' });
    const today = new Date().toISOString().split('T')[0];
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
