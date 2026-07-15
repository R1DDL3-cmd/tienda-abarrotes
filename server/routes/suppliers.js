const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.use(authMiddleware);
router.use(adminMiddleware);

function recordInventoryMovement(productId, type, quantity, stockBefore, stockAfter, referenceType, referenceId, notes, userId) {
  const db = getDB();
  db.run(`INSERT INTO inventory_movements (product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, type, quantity, stockBefore, stockAfter, referenceType, referenceId, notes, userId]);
}

function updateProductStock(productId, quantity, userId, referenceType, referenceId, notes) {
  const db = getDB();
  const product = db.prepare('SELECT id, stock, name FROM products WHERE id = ?').get(productId);
  if (!product) return;
  const stockBefore = product.stock;
  const stockAfter = stockBefore + quantity;
  db.run('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [stockAfter, productId]);
  recordInventoryMovement(productId, 'in', quantity, stockBefore, stockAfter, referenceType, referenceId, notes, userId);
}

router.post('/suppliers/sync-from-products', (req, res) => {
  try {
    const db = getDB();
    const productSuppliers = db.prepare(`SELECT DISTINCT supplier FROM products WHERE supplier IS NOT NULL AND supplier != ''`).all();
    let created = 0;
    productSuppliers.forEach(ps => {
      const name = ps.supplier.trim();
      if (!name) return;
      const existing = db.prepare('SELECT id FROM suppliers WHERE name = ? AND active = 1').get(name);
      if (!existing) {
        db.run('INSERT INTO suppliers (name, notes) VALUES (?, ?)', [name, 'Importado de productos']);
        created++;
      }
    });
    res.json({ message: `Sincronizados ${created} proveedores nuevos`, created });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/suppliers', (req, res) => {
  try {
    const db = getDB();
    const search = req.query.search || '';
    let suppliers;
    if (search) {
      suppliers = db.prepare(`SELECT * FROM suppliers WHERE active = 1 AND (name LIKE ? OR contact LIKE ? OR phone LIKE ?) ORDER BY name`).all(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      suppliers = db.prepare(`SELECT * FROM suppliers WHERE active = 1 ORDER BY name`).all();
    }
    res.json(suppliers);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/suppliers/all', (req, res) => {
  try {
    const db = getDB();
    const suppliers = db.prepare(`SELECT * FROM suppliers WHERE active = 1 ORDER BY name`).all();
    res.json(suppliers);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/suppliers/:id', (req, res) => {
  try {
    const db = getDB();
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(supplier);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/suppliers', (req, res) => {
  try {
    const db = getDB();
    const { name, contact, phone, email, address, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
    const result = db.prepare('INSERT INTO suppliers (name, contact, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)').run(name.trim(), contact || '', phone || '', email || '', address || '', notes || '');
    res.json({ id: result.lastInsertRowid, message: 'Proveedor creado' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/suppliers/:id', (req, res) => {
  try {
    const db = getDB();
    const { name, contact, phone, email, address, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
    db.run('UPDATE suppliers SET name = ?, contact = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?',
      [name.trim(), contact || '', phone || '', email || '', address || '', notes || '', req.params.id]);
    res.json({ message: 'Proveedor actualizado' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/suppliers/:id', (req, res) => {
  try {
    const db = getDB();
    db.run('UPDATE suppliers SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Proveedor desactivado' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/suppliers/:id/purchases', (req, res) => {
  try {
    const db = getDB();
    const purchases = db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.supplier_id = ? ORDER BY p.created_at DESC`).all(req.params.id);
    res.json(purchases);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/purchases', (req, res) => {
  try {
    const db = getDB();
    const { status, supplier_id } = req.query;
    let sql = `SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND p.status = ?`; params.push(status); }
    if (supplier_id) { sql += ` AND p.supplier_id = ?`; params.push(supplier_id); }
    sql += ` ORDER BY p.created_at DESC`;
    const purchases = db.prepare(sql).all(params);
    res.json(purchases);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/purchases/:id', (req, res) => {
  try {
    const db = getDB();
    const purchase = db.prepare(`SELECT p.*, s.name AS supplier_name, s.contact AS supplier_contact, s.phone AS supplier_phone FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`).get(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
    const items = db.prepare('SELECT pi.*, pr.barcode FROM purchase_items pi LEFT JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ?').all(req.params.id);
    res.json({ ...purchase, items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/purchases', (req, res) => {
  try {
    const db = getDB();
    const { supplier_id, invoice_number, items, notes, status } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'El proveedor es obligatorio' });
    if (!items || !items.length) return res.status(400).json({ error: 'Debe agregar al menos un producto' });

    const purchaseStatus = status === 'pending' ? 'pending' : 'completed';
    let subtotal = 0;
    items.forEach(item => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      item.subtotal = qty * price;
      subtotal += item.subtotal;
    });
    const tax = subtotal * 0.16;
    const total = subtotal + tax;

    const result = db.run('INSERT INTO purchases (supplier_id, invoice_number, subtotal, tax, total, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [supplier_id, invoice_number || '', subtotal, tax, total, purchaseStatus, notes || '', req.user.id]);

    const purchaseId = result.lastInsertRowid;

    const insertItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)');
    items.forEach(item => {
      insertItem.run(purchaseId, item.product_id || null, item.product_name || 'Producto', parseFloat(item.quantity) || 0, parseFloat(item.unit_price) || 0, item.subtotal);
    });

    if (purchaseStatus === 'completed') {
      items.forEach(item => {
        if (item.product_id) {
          updateProductStock(item.product_id, parseFloat(item.quantity) || 0, req.user.id, 'purchase', purchaseId, `Compra #${purchaseId}`);
        }
      });
    }

    res.json({ id: purchaseId, message: purchaseStatus === 'pending' ? 'Pedido creado' : 'Compra registrada e inventariada' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/purchases/:id/receive', (req, res) => {
  try {
    const db = getDB();
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
    if (purchase.status !== 'pending') return res.status(400).json({ error: 'Solo se pueden recibir pedidos pendientes' });

    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(req.params.id);
    
    const transact = db.transaction(() => {
      db.run('UPDATE purchases SET status = ? WHERE id = ?', ['completed', req.params.id]);
      items.forEach(item => {
        if (item.product_id) {
          updateProductStock(item.product_id, item.quantity, req.user.id, 'purchase', purchase.id, `Recepcion de pedido #${purchase.id}`);
        }
      });
    });
    transact();

    res.json({ message: 'Pedido recibido e inventariado' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/purchases/:id', (req, res) => {
  try {
    const db = getDB();
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);

    const transact = db.transaction(() => {
      if (purchase.status === 'completed') {
        const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(req.params.id);
        items.forEach(item => {
          if (item.product_id) {
            const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
            if (product) {
              const stockBefore = product.stock;
              const stockAfter = stockBefore - item.quantity;
              db.run('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [Math.max(0, stockAfter), item.product_id]);
              recordInventoryMovement(item.product_id, 'out', item.quantity, stockBefore, Math.max(0, stockAfter), 'purchase_cancel', purchase.id, `Cancelacion de compra #${purchase.id}`, req.user.id);
            }
          }
        });
      }
      db.run('UPDATE purchases SET status = ? WHERE id = ?', ['cancelled', req.params.id]);
    });
    transact();

    res.json({ message: 'Compra cancelada' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
