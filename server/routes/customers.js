const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDB();
  const search = req.query.search || '';
  let where = 'WHERE active = 1';
  const params = [];
  if (search) {
    where += ' AND (name LIKE ? OR phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  const customers = db.prepare(`SELECT * FROM customers ${where} ORDER BY name ASC`).all(...params);
  res.json({ customers });
});

router.get('/:id', authMiddleware, (req, res) => {
  const db = getDB();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });
  const payments = db.prepare('SELECT * FROM customer_payments WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
  const sales = db.prepare("SELECT * FROM sales WHERE customer_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 50").all(req.params.id);
  res.json({ customer, payments, sales });
});

router.post('/', authMiddleware, (req, res) => {
  const db = getDB();
  const { name, phone, address, credit_limit, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre del cliente requerido' });
  const result = db.prepare(
    'INSERT INTO customers (name, phone, address, credit_limit, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(name, phone || null, address || null, credit_limit || 0, notes || null);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(customer);
});

router.put('/:id', authMiddleware, (req, res) => {
  const db = getDB();
  const { name, phone, address, credit_limit, notes } = req.body;
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
  db.prepare(
    'UPDATE customers SET name = ?, phone = ?, address = ?, credit_limit = ?, notes = ? WHERE id = ?'
  ).run(
    name || existing.name,
    phone !== undefined ? phone : existing.phone,
    address !== undefined ? address : existing.address,
    credit_limit !== undefined ? credit_limit : existing.credit_limit,
    notes !== undefined ? notes : existing.notes,
    req.params.id
  );
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(customer);
});

router.post('/:id/payment', authMiddleware, (req, res) => {
  const db = getDB();
  const { amount, payment_method, notes } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });
  db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amount, req.params.id);
  db.prepare(
    'INSERT INTO customer_payments (customer_id, amount, payment_method, notes, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, amount, payment_method || 'cash', notes || null, req.user.id);
  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json({ customer: updated, success: true });
});

router.get('/:id/history', authMiddleware, (req, res) => {
  const db = getDB();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

  const sales = db.prepare(
    "SELECT * FROM sales WHERE customer_id = ? AND status = 'completed' ORDER BY created_at DESC"
  ).all(req.params.id);

  const payments = db.prepare(
    'SELECT * FROM customer_payments WHERE customer_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);

  for (const sale of sales) {
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  }

  res.json({ customer, sales, payments });
});

module.exports = router;
