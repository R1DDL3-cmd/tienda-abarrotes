const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, inventoryAdminMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const category = req.query.category || '';
  const lowStock = req.query.lowStock === 'true';

  let where = 'WHERE p.active = 1';
  const params = [];

  if (search) {
    where += ' AND (p.name LIKE ? OR p.barcode LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    where += ' AND p.category_id = ?';
    params.push(category);
  }

  if (lowStock) {
    where += ' AND p.stock <= p.min_stock';
  }

  const countResult = db.prepare(`SELECT COUNT(*) as total FROM products p ${where}`).get(...params);
  const total = countResult.total;

  const products = db.prepare(
    `SELECT p.*, COALESCE(c.name, p.category_name) as category_name 
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id 
     ${where} 
     ORDER BY p.name ASC 
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ products, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get('/all', authMiddleware, (req, res) => {
  const db = getDB();
  const products = db.prepare(
    `SELECT p.*, COALESCE(c.name, p.category_name) as category_name 
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id 
     WHERE p.active = 1 
     ORDER BY p.name ASC`
  ).all();
  res.json({ products });
});

router.get('/barcode/:barcode', authMiddleware, (req, res) => {
  const db = getDB();
  const product = db.prepare(
    `SELECT p.*, COALESCE(c.name, p.category_name) as category_name 
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id 
     WHERE p.barcode = ? AND p.active = 1`
  ).get(req.params.barcode);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(product);
});

router.get('/low-stock', authMiddleware, (req, res) => {
  const db = getDB();
  const products = db.prepare(
    `SELECT p.*, COALESCE(c.name, p.category_name) as category_name 
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id 
     WHERE p.active = 1 AND p.stock <= p.min_stock 
     ORDER BY (p.stock * 1.0 / CASE WHEN p.min_stock = 0 THEN 1 ELSE p.min_stock END) ASC`
  ).all();
  res.json({ products });
});

router.get('/expiring', authMiddleware, (req, res) => {
  // La caducidad se lleva por lote en product_batches (ver /batches/:productId),
  // no en products.expiry_date — esa columna se eliminó en la migración de esquema v1.
  const db = getDB();
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  const dateStr = thirtyDays.toISOString().split('T')[0];

  const products = db.prepare(
    `SELECT p.*, pb.id as batch_id, pb.batch_code, pb.quantity as batch_quantity, pb.expiry_date
     FROM product_batches pb
     JOIN products p ON pb.product_id = p.id
     WHERE pb.expiry_date IS NOT NULL AND pb.expiry_date <= ? AND p.active = 1
     ORDER BY pb.expiry_date ASC`
  ).all(dateStr);
  res.json({ products });
});

router.post('/', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { name, barcode, category_id, purchase_price, sale_price, stock, min_stock, supplier, unit_type } = req.body;

    if (!name || sale_price === undefined) {
      return res.status(400).json({ error: 'Nombre y precio de venta son requeridos' });
    }

    const existingBarcode = barcode ? db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode) : null;
    if (existingBarcode) {
      return res.status(400).json({ error: 'Ya existe un producto con ese código de barras' });
    }

    let finalBarcode = barcode;
    if (!finalBarcode) {
      finalBarcode = 'BAR-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    let categoryName = null;
    if (category_id) {
      const cat = db.prepare('SELECT name FROM categories WHERE id = ?').get(category_id);
      if (cat) categoryName = cat.name;
    }

    const result = db.prepare(
      `INSERT INTO products (barcode, name, category_id, category_name, purchase_price, sale_price, stock, min_stock, supplier, unit_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(finalBarcode, name, category_id || null, categoryName, purchase_price || 0, sale_price, stock || 0, min_stock || 0, supplier || null, unit_type || 'unit');

    let productId = result.lastInsertRowid;
    if (!productId || productId === 0) {
      const lastProduct = db.prepare('SELECT id FROM products ORDER BY id DESC LIMIT 1').get();
      if (lastProduct) productId = lastProduct.id;
    }

    if ((stock || 0) > 0) {
      db.prepare(
        'INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, notes, created_by) VALUES (?, ?, ?, 0, ?, ?, ?, ?)'
      ).run(productId, 'in', stock || 0, stock || 0, 'initial', 'Inventario inicial', req.user.id);
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(500).json({ error: 'Error al recuperar el producto' });
    res.status(201).json(product);
  } catch (e) {
    console.error('Error creating product:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Error al crear producto: ' + e.message });
  }
});

router.put('/:id', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const { name, barcode, category_id, purchase_price, sale_price, stock, min_stock, supplier, unit_type } = req.body;

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  if (barcode && barcode !== existing.barcode) {
    const dup = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(barcode, req.params.id);
    if (dup) return res.status(400).json({ error: 'Ya existe otro producto con ese código de barras' });
  }

  let categoryName = existing.category_name;
  if (category_id) {
    const cat = db.prepare('SELECT name FROM categories WHERE id = ?').get(category_id);
    if (cat) categoryName = cat.name;
  }

  db.prepare(
    `UPDATE products SET name = ?, barcode = ?, category_id = ?, category_name = ?, purchase_price = ?, sale_price = ?, min_stock = ?, supplier = ?, unit_type = ?, updated_at = datetime("now")
     WHERE id = ?`
  ).run(
    name || existing.name,
    barcode || existing.barcode,
    category_id !== undefined ? category_id : existing.category_id,
    categoryName,
    purchase_price !== undefined ? purchase_price : existing.purchase_price,
    sale_price !== undefined ? sale_price : existing.sale_price,
    min_stock !== undefined ? min_stock : existing.min_stock,
    supplier !== undefined ? supplier : existing.supplier,
    unit_type || existing.unit_type || 'unit',
    req.params.id
  );

  if (stock !== undefined && stock !== existing.stock) {
    const diff = stock - existing.stock;
    const oldStock = existing.stock;
    db.prepare(
      'INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, diff > 0 ? 'in' : 'out', Math.abs(diff), oldStock, stock, 'adjustment', 'Ajuste manual de inventario', req.user.id);

    db.prepare('UPDATE products SET stock = ?, updated_at = datetime("now") WHERE id = ?').run(stock, req.params.id);
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(product);
});

router.get('/batches/:productId', authMiddleware, (req, res) => {
  const db = getDB();
  const batches = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC').all(req.params.productId);
  res.json({ batches });
});

router.post('/batches/:productId', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const { batch_code, quantity, expiry_date } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  let batchId;
  const transaction = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO product_batches (product_id, batch_code, quantity, expiry_date) VALUES (?, ?, ?, ?)'
    ).run(req.params.productId, batch_code || null, quantity, expiry_date || null);
    batchId = result.lastInsertRowid;
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(quantity, req.params.productId);
    db.prepare(
      'INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.productId, 'in', quantity, parseFloat(product.stock || 0), parseFloat(product.stock || 0) + quantity, 'batch', 'Lote: ' + (batch_code || 'N/A') + (expiry_date ? ' Caduca: ' + expiry_date : ''), req.user.id);
  });

  try {
    transaction();
  } catch (e) {
    return res.status(500).json({ error: 'Error al registrar el lote: ' + e.message });
  }

  const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(batchId);
  res.status(201).json(batch);
});

router.delete('/batches/:batchId', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Lote no encontrado' });
  const product = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(batch.product_id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (product.stock < batch.quantity) {
    return res.status(400).json({ error: `Stock insuficiente para eliminar lote: ${product.name} tiene ${product.stock}, el lote tiene ${batch.quantity}` });
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM product_batches WHERE id = ?').run(req.params.batchId);
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(batch.quantity, batch.product_id);
  });

  try {
    transaction();
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar el lote: ' + e.message });
  }

  res.json({ success: true });
});

router.delete('/:id', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/categories', authMiddleware, (req, res) => {
  const db = getDB();
  const categories = db.prepare(
    `SELECT c.*, COUNT(p.id) as product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
     GROUP BY c.id
     ORDER BY c.name ASC`
  ).all();
  res.json({ categories });
});

router.post('/categories', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre de categoría requerido' });

  try {
    const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ id: result.lastInsertRowid, name });
  } catch (e) {
    res.status(400).json({ error: 'La categoría ya existe' });
  }
});

router.put('/categories/:id', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre de categoría requerido' });
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
    db.prepare('UPDATE products SET category_name = ? WHERE category_id = ?').run(name, req.params.id);
    res.json({ id: parseInt(req.params.id), name });
  } catch (e) {
    res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
  }
});

router.delete('/categories/:id', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });
  db.prepare('UPDATE products SET category_id = NULL, category_name = NULL WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/kardex/:productId', authMiddleware, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const countResult = db.prepare('SELECT COUNT(*) as total FROM inventory_movements WHERE product_id = ?').get(req.params.productId);
  const movements = db.prepare(
    `SELECT im.*, u.name as created_by_name 
     FROM inventory_movements im 
     LEFT JOIN users u ON im.created_by = u.id 
     WHERE im.product_id = ? 
     ORDER BY im.created_at DESC 
     LIMIT ? OFFSET ?`
  ).all(req.params.productId, limit, offset);

  res.json({ movements, total: countResult.total, page, limit });
});

module.exports = router;
