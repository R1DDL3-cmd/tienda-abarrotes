const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { authMiddleware, purchasesMiddleware } = require('../middleware/auth');
const { predictAll } = require('../services/predictions');
const { businessToday } = require('../bizdate');

router.use(authMiddleware);
router.use(purchasesMiddleware);

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

// Una compra confirmada (directa o recibida) se refleja como gasto en
// Contabilidad — antes solo afectaba el inventario y nunca aparecía ahí,
// pese a ser dinero real que sale de la caja.
function recordPurchaseExpense(purchaseId, supplierName, amount, invoiceNumber, userId, userName) {
  const db = getDB();
  db.prepare(
    `INSERT INTO expenses (description, amount, category, payment_method, notes, created_by, reference_type, reference_id)
     VALUES (?, ?, 'Compra a proveedor', 'cash', ?, ?, 'purchase', ?)`
  ).run(`Compra a proveedor: ${supplierName || 'Sin proveedor'}`, amount, invoiceNumber ? `Factura: ${invoiceNumber}` : null, userId, purchaseId);

  const today = businessToday();
  const register = db.prepare('SELECT id FROM cash_register WHERE date = ?').get(today);
  if (register) {
    db.prepare(
      `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
       VALUES (?, 'expense', ?, ?, ?, 'purchase', ?, ?, datetime('now'))`
    ).run(register.id, `Compra a proveedor #${purchaseId} — ${supplierName || ''}`, amount, purchaseId, userId, userName || '');
  }
}

function removePurchaseExpense(purchaseId) {
  const db = getDB();
  db.run("DELETE FROM expenses WHERE reference_type = 'purchase' AND reference_id = ?", [purchaseId]);
  // También el movimiento de caja que generó (ver recordPurchaseExpense) —
  // si se queda, el efectivo esperado del corte carga un gasto que ya no existe.
  db.run("DELETE FROM cash_movements WHERE type = 'expense' AND reference_type = 'purchase' AND reference_id = ?", [purchaseId]);
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

router.get('/suppliers/:id/suggested-order', (req, res) => {
  try {
    const db = getDB();
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const supplierProducts = db.prepare(
      `SELECT id, name, barcode, stock, min_stock, purchase_price FROM products WHERE active = 1 AND supplier_id = ?`
    ).all(req.params.id);
    const productIds = new Set(supplierProducts.map(p => p.id));

    const predictions = predictAll(db);
    const predictionByProduct = {};
    for (const p of predictions) predictionByProduct[p.product_id] = p;

    const items = supplierProducts
      .map(p => {
        const pred = predictionByProduct[p.id];
        // Fallback para productos sin historial de ventas suficiente: el motor
        // de predicciones devuelve suggested_order = 0 en ese caso (no hay
        // datos con qué pronosticar). Solo aplica si el stock ya está en o
        // por debajo del mínimo configurado (mismo criterio que /low-stock),
        // y busca llegar al doble del mínimo.
        const isLowStock = p.min_stock > 0 && p.stock <= p.min_stock;
        const fallbackQty = isLowStock ? Math.max(0, (p.min_stock * 2) - p.stock) : 0;
        const suggestedQty = (pred && pred.suggested_order > 0) ? pred.suggested_order : fallbackQty;
        return {
          product_id: p.id,
          product_name: p.name,
          barcode: p.barcode,
          current_stock: p.stock,
          min_stock: p.min_stock,
          unit_price: p.purchase_price || 0,
          suggested_quantity: Math.ceil(suggestedQty),
          days_until_stockout: pred ? pred.days_until_stockout : null
        };
      })
      .filter(i => i.suggested_quantity > 0)
      .sort((a, b) => (a.days_until_stockout ?? 999) - (b.days_until_stockout ?? 999));

    res.json({ supplier, items });
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

    // db.run() (a diferencia de db.prepare().run()) no devuelve lastInsertRowid
    // — por eso crear un pedido/compra estaba roto antes de este fix.
    const result = db.prepare('INSERT INTO purchases (supplier_id, invoice_number, subtotal, tax, total, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(supplier_id, invoice_number || '', subtotal, tax, total, purchaseStatus, notes || '', req.user.id);

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
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
      recordPurchaseExpense(purchaseId, supplier?.name, total, invoice_number, req.user.id, req.user.name);
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

    // El body puede traer overrides por artículo (lo que realmente llegó y a qué
    // precio); si no vienen, se recibe tal cual fue pedido — así el flujo actual
    // del frontend (botón "Recibir" sin modal) sigue funcionando igual.
    const overrides = {};
    if (Array.isArray(req.body?.items)) {
      for (const o of req.body.items) {
        if (o && o.id != null) overrides[o.id] = o;
      }
    }

    let newSubtotal = 0;

    const transact = db.transaction(() => {
      items.forEach(item => {
        const override = overrides[item.id] || {};
        const receivedQty = override.received_quantity !== undefined && override.received_quantity !== null
          ? parseFloat(override.received_quantity) || 0
          : parseFloat(item.quantity) || 0;
        const receivedPrice = override.received_unit_price !== undefined && override.received_unit_price !== null
          ? parseFloat(override.received_unit_price) || 0
          : parseFloat(item.unit_price) || 0;

        db.run('UPDATE purchase_items SET received_quantity = ?, received_unit_price = ? WHERE id = ?',
          [receivedQty, receivedPrice, item.id]);
        newSubtotal += receivedQty * receivedPrice;

        if (item.product_id && receivedQty > 0) {
          updateProductStock(item.product_id, receivedQty, req.user.id, 'purchase', purchase.id, `Recepcion de pedido #${purchase.id}`);
          // El costo recibido es el más confiable que tenemos del producto:
          // actualizarlo aquí mantiene precisos los cálculos de ganancia
          // (accounting.js /profit usa products.purchase_price).
          if (receivedPrice > 0) {
            db.run('UPDATE products SET purchase_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [receivedPrice, item.product_id]);
          }
        }
      });

      const newTax = newSubtotal * 0.16;
      const newTotal = newSubtotal + newTax;
      db.run('UPDATE purchases SET status = ?, subtotal = ?, tax = ?, total = ? WHERE id = ?',
        ['completed', newSubtotal, newTax, newTotal, req.params.id]);

      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(purchase.supplier_id);
      recordPurchaseExpense(purchase.id, supplier?.name, newTotal, purchase.invoice_number, req.user.id, req.user.name);
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
            // Si el pedido pasó por recepción, lo que entró al inventario fue
            // received_quantity (puede diferir de lo pedido); si no tiene
            // valor (compra directa sin flujo de recepción), se usa quantity.
            const qtyToRevert = item.received_quantity != null ? item.received_quantity : item.quantity;
            const product = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(item.product_id);
            if (product) {
              if (product.stock < qtyToRevert) {
                throw new Error(`Stock insuficiente para cancelar: ${product.name} tiene ${product.stock}, necesita ${qtyToRevert}`);
              }
              const stockBefore = product.stock;
              const stockAfter = stockBefore - qtyToRevert;
              db.run('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [stockAfter, item.product_id]);
              recordInventoryMovement(item.product_id, 'out', qtyToRevert, stockBefore, stockAfter, 'purchase_cancel', purchase.id, `Cancelacion de compra #${purchase.id}`, req.user.id);
            }
          }
        });
        // El gasto se registró al confirmarse/recibirse la compra (ver
        // recordPurchaseExpense) — al cancelarla, se quita también, igual
        // que ya se revierte el stock arriba.
        removePurchaseExpense(purchase.id);
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
