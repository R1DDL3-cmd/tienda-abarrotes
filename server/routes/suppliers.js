const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { authMiddleware, purchasesMiddleware, adminMiddleware } = require('../middleware/auth');
const { predictAll } = require('../services/predictions');
const { businessToday } = require('../bizdate');
const { recordPriceChange } = require('../services/priceHistory');

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
    const { supplier_id, invoice_number, items, notes, status, payment_type, due_date } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'El proveedor es obligatorio' });
    if (!items || !items.length) return res.status(400).json({ error: 'Debe agregar al menos un producto' });

    // 'cash' (contado, el default de siempre) o 'credit' (a crédito: se debe
    // al proveedor y el gasto se registra hasta que se paga).
    const paymentType = payment_type === 'credit' ? 'credit' : 'cash';
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
      return res.status(400).json({ error: 'Fecha de pago inválida' });
    }

    const purchaseStatus = status === 'pending' ? 'pending' : 'completed';
    let subtotal = 0;
    for (const item of items) {
      const qty = parseFloat(item.quantity);
      const price = parseFloat(item.unit_price);
      // Cantidades/precios negativos o no numéricos corrompían el stock y el
      // gasto registrado en contabilidad.
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: `Cantidad inválida en "${item.product_name || 'producto'}"` });
      }
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ error: `Precio inválido en "${item.product_name || 'producto'}"` });
      }
      item.quantity = qty;
      item.unit_price = price;
      item.subtotal = qty * price;
      subtotal += item.subtotal;
    }
    const tax = subtotal * 0.16;
    const total = subtotal + tax;

    // Todo o nada: antes cada paso (compra, artículos, stock, gasto) se
    // escribía suelto — un error a la mitad dejaba una compra fantasma sin
    // artículos o con el inventario a medio actualizar.
    let purchaseId;
    const transact = db.transaction(() => {
      // db.run() (a diferencia de db.prepare().run()) no devuelve lastInsertRowid
      // — por eso crear un pedido/compra estaba roto antes de este fix.
      const result = db.prepare('INSERT INTO purchases (supplier_id, invoice_number, subtotal, tax, total, status, notes, created_by, payment_type, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(supplier_id, invoice_number || '', subtotal, tax, total, purchaseStatus, notes || '', req.user.id, paymentType, due_date || null);

      purchaseId = result.lastInsertRowid;

      const insertItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)');
      items.forEach(item => {
        insertItem.run(purchaseId, item.product_id || null, item.product_name || 'Producto', item.quantity, item.unit_price, item.subtotal);
      });

      if (purchaseStatus === 'completed') {
        items.forEach(item => {
          if (item.product_id) {
            updateProductStock(item.product_id, item.quantity, req.user.id, 'purchase', purchaseId, `Compra #${purchaseId}`);
          }
        });
        // Solo las compras de CONTADO son gasto inmediato — en una compra a
        // crédito el dinero todavía no sale: el gasto se registra al pagarla
        // (ver POST /purchases/:id/payments).
        if (paymentType === 'cash') {
          const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
          recordPurchaseExpense(purchaseId, supplier?.name, total, invoice_number, req.user.id, req.user.name);
        }
      }
    });
    transact();

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
        if (o && o.id != null) {
          const rq = o.received_quantity, rp = o.received_unit_price;
          if ((rq !== undefined && rq !== null && (!Number.isFinite(parseFloat(rq)) || parseFloat(rq) < 0)) ||
              (rp !== undefined && rp !== null && (!Number.isFinite(parseFloat(rp)) || parseFloat(rp) < 0))) {
            return res.status(400).json({ error: 'Cantidad o precio recibido inválido' });
          }
          overrides[o.id] = o;
        }
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
            const before = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(item.product_id);
            recordPriceChange(getDB(), {
              productId: item.product_id, field: 'purchase_price',
              oldValue: before ? before.purchase_price : null, newValue: receivedPrice,
              source: `recepción de compra #${purchase.id}`, user: req.user,
            });
            db.run('UPDATE products SET purchase_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [receivedPrice, item.product_id]);
          }
        }
      });

      const newTax = newSubtotal * 0.16;
      const newTotal = newSubtotal + newTax;
      db.run('UPDATE purchases SET status = ?, subtotal = ?, tax = ?, total = ? WHERE id = ?',
        ['completed', newSubtotal, newTax, newTotal, req.params.id]);

      // Compra a crédito: el gasto se registra al pagarla, no al recibirla.
      if ((purchase.payment_type || 'cash') === 'cash') {
        const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(purchase.supplier_id);
        recordPurchaseExpense(purchase.id, supplier?.name, newTotal, purchase.invoice_number, req.user.id, req.user.name);
      }
    });
    transact();

    res.json({ message: 'Pedido recibido e inventariado' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
// CUENTAS POR PAGAR (compras a crédito)
// ============================================================

// Resumen de deuda por proveedor + compras a crédito con saldo pendiente.
router.get('/accounts-payable', (req, res) => {
  try {
    const db = getDB();
    const today = businessToday();
    const open = db.prepare(
      `SELECT p.id, p.supplier_id, s.name AS supplier_name, p.invoice_number, p.total,
              COALESCE(p.amount_paid, 0) AS amount_paid,
              (p.total - COALESCE(p.amount_paid, 0)) AS balance,
              p.due_date, p.created_at,
              CASE WHEN p.due_date IS NOT NULL AND p.due_date < ? THEN 1 ELSE 0 END AS overdue
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.status = 'completed' AND p.payment_type = 'credit'
         AND (p.total - COALESCE(p.amount_paid, 0)) > 0.009
       ORDER BY overdue DESC, p.due_date ASC, p.created_at ASC`
    ).all(today);

    const bySupplier = {};
    for (const p of open) {
      if (!bySupplier[p.supplier_id]) {
        bySupplier[p.supplier_id] = { supplier_id: p.supplier_id, supplier_name: p.supplier_name, total_owed: 0, purchases: 0, overdue: 0 };
      }
      bySupplier[p.supplier_id].total_owed += p.balance;
      bySupplier[p.supplier_id].purchases += 1;
      if (p.overdue) bySupplier[p.supplier_id].overdue += 1;
    }

    res.json({
      total_owed: open.reduce((s, p) => s + p.balance, 0),
      suppliers: Object.values(bySupplier).sort((a, b) => b.total_owed - a.total_owed),
      purchases: open,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/purchases/:id/payments', (req, res) => {
  try {
    const db = getDB();
    const payments = db.prepare('SELECT * FROM supplier_payments WHERE purchase_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json({ payments });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Registrar un pago/abono a una compra a crédito. AQUÍ es donde nace el gasto
// en contabilidad (y el movimiento de caja si fue en efectivo) — es cuando el
// dinero realmente sale.
router.post('/purchases/:id/payments', (req, res) => {
  try {
    const db = getDB();
    const { amount, payment_method, notes } = req.body;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
    if (purchase.status !== 'completed') return res.status(400).json({ error: 'Solo se pueden pagar compras recibidas' });
    if ((purchase.payment_type || 'cash') !== 'credit') return res.status(400).json({ error: 'Esta compra fue de contado — no tiene saldo por pagar' });

    const balance = purchase.total - (purchase.amount_paid || 0);
    if (amt > balance + 0.009) {
      return res.status(400).json({ error: `El pago excede el saldo pendiente ($${balance.toFixed(2)})` });
    }

    const method = payment_method === 'transfer' || payment_method === 'card' ? payment_method : 'cash';
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(purchase.supplier_id);
    let paymentId;

    const transact = db.transaction(() => {
      const result = db.prepare(
        `INSERT INTO supplier_payments (purchase_id, supplier_id, amount, payment_method, notes, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(purchase.id, purchase.supplier_id, amt, method, notes || null, req.user.id, req.user.name || '');
      paymentId = result.lastInsertRowid;

      db.prepare('UPDATE purchases SET amount_paid = COALESCE(amount_paid, 0) + ? WHERE id = ?').run(amt, purchase.id);

      db.prepare(
        `INSERT INTO expenses (description, amount, category, payment_method, notes, created_by, reference_type, reference_id)
         VALUES (?, ?, 'Pago a proveedor', ?, ?, ?, 'purchase_payment', ?)`
      ).run(`Pago a ${supplier?.name || 'proveedor'} — compra #${purchase.id}`, amt, method, notes || null, req.user.id, paymentId);

      if (method === 'cash') {
        const register = db.prepare('SELECT id FROM cash_register WHERE date = ?').get(businessToday());
        if (register) {
          db.prepare(
            `INSERT INTO cash_movements (cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at)
             VALUES (?, 'expense', ?, ?, ?, 'purchase_payment', ?, ?, datetime('now'))`
          ).run(register.id, `Pago a proveedor ${supplier?.name || ''} — compra #${purchase.id}`, amt, paymentId, req.user.id, req.user.name || '');
        }
      }
    });
    transact();

    const updated = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchase.id);
    res.status(201).json({ payment_id: paymentId, purchase: updated, balance: updated.total - updated.amount_paid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Eliminar un pago registrado por error (solo admin): revierte el saldo, el
// gasto y el movimiento de caja que ese pago generó.
router.delete('/purchases/payments/:paymentId', adminMiddleware, (req, res) => {
  try {
    const db = getDB();
    const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

    const transact = db.transaction(() => {
      db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(payment.id);
      db.prepare('UPDATE purchases SET amount_paid = COALESCE(amount_paid, 0) - ? WHERE id = ?').run(payment.amount, payment.purchase_id);
      db.prepare("DELETE FROM expenses WHERE reference_type = 'purchase_payment' AND reference_id = ?").run(payment.id);
      db.prepare("DELETE FROM cash_movements WHERE reference_type = 'purchase_payment' AND reference_id = ?").run(payment.id);
    });
    transact();
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/purchases/:id', (req, res) => {
  try {
    const db = getDB();
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    // Antes esto tronaba con un error críptico al leer purchase.status de undefined
    if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
    if (purchase.status === 'cancelled') return res.status(400).json({ error: 'Esta compra ya fue cancelada' });
    // Con pagos hechos, cancelar dejaría dinero pagado "en el aire": primero
    // hay que eliminar los pagos (admin) y luego cancelar.
    if ((purchase.amount_paid || 0) > 0.009) {
      return res.status(400).json({ error: 'Esta compra tiene pagos registrados. Elimina primero sus pagos y vuelve a intentar.' });
    }

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
