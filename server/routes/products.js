const express = require('express');
const XLSX = require('xlsx');
const { getDB } = require('../db');
const { authMiddleware, inventoryAdminMiddleware } = require('../middleware/auth');

const router = express.Router();

function unitTypeToLabel(u) {
  if (u === 'kg') return 'Kg';
  if (u === 'l') return 'Litro';
  return 'Pieza';
}

function labelToUnitType(v) {
  const val = String(v || '').trim().toLowerCase();
  if (['kg', 'kilo', 'kilos', 'kls', 'kls.'].includes(val)) return 'kg';
  if (['l', 'lt', 'lt.', 'litro', 'litros', 'ml', 'ml.'].includes(val)) return 'l';
  return 'unit';
}

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
     ORDER BY p.needs_review DESC, p.name ASC
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
  let product = db.prepare(
    `SELECT p.*, COALESCE(c.name, p.category_name) as category_name
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.barcode = ? AND p.active = 1`
  ).get(req.params.barcode);
  if (!product) {
    // No coincide con el código principal — probar códigos adicionales
    // (mismo producto con varias presentaciones/etiquetas de báscula, etc.)
    product = db.prepare(
      `SELECT p.*, COALESCE(c.name, p.category_name) as category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       JOIN product_barcodes pb ON pb.product_id = p.id
       WHERE pb.barcode = ? AND p.active = 1`
    ).get(req.params.barcode);
  }
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(product);
});

router.get('/:id/barcodes', authMiddleware, (req, res) => {
  const db = getDB();
  const barcodes = db.prepare('SELECT * FROM product_barcodes WHERE product_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ barcodes });
});

router.post('/:id/barcodes', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const { barcode } = req.body;
  const trimmed = (barcode || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Código de barras requerido' });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  const collidesWithPrimary = db.prepare('SELECT id FROM products WHERE barcode = ?').get(trimmed);
  if (collidesWithPrimary) return res.status(400).json({ error: 'Ese código ya está en uso como código principal de otro producto' });
  const collidesWithExtra = db.prepare('SELECT id FROM product_barcodes WHERE barcode = ?').get(trimmed);
  if (collidesWithExtra) return res.status(400).json({ error: 'Ese código ya está asignado a otro producto' });

  const result = db.prepare('INSERT INTO product_barcodes (product_id, barcode) VALUES (?, ?)').run(req.params.id, trimmed);
  const created = db.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

router.delete('/barcodes/:barcodeId', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM product_barcodes WHERE id = ?').get(req.params.barcodeId);
  if (!existing) return res.status(404).json({ error: 'Código no encontrado' });
  db.prepare('DELETE FROM product_barcodes WHERE id = ?').run(req.params.barcodeId);
  res.json({ success: true });
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
    const { name, barcode, category_id, purchase_price, sale_price, stock, min_stock, supplier, supplier_id, unit_type, sellable_individually, units_per_package, individual_price } = req.body;

    if (!name || sale_price === undefined) {
      return res.status(400).json({ error: 'Nombre y precio de venta son requeridos' });
    }

    // supplier_id es el vínculo real con la tabla suppliers (lo que usa
    // Compras para buscar productos de un proveedor); supplier (texto) se
    // mantiene en espejo solo para las pantallas que todavía muestran el
    // nombre como texto plano.
    let supplierName = supplier || null;
    if (supplier_id) {
      const sup = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
      if (!sup) return res.status(400).json({ error: 'Proveedor no encontrado' });
      supplierName = sup.name;
    }

    if (sellable_individually) {
      if (!units_per_package || units_per_package <= 0) {
        return res.status(400).json({ error: 'Indica cuántas unidades individuales trae cada paquete' });
      }
      if (!individual_price || individual_price <= 0) {
        return res.status(400).json({ error: 'Indica el precio de la unidad individual' });
      }
    }

    const existingBarcode = barcode ? db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode) : null;
    if (existingBarcode) {
      return res.status(400).json({ error: 'Ya existe un producto con ese código de barras' });
    }
    const existingExtraBarcode = barcode ? db.prepare('SELECT id FROM product_barcodes WHERE barcode = ?').get(barcode) : null;
    if (existingExtraBarcode) {
      return res.status(400).json({ error: 'Ese código ya está asignado como código adicional de otro producto' });
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
      `INSERT INTO products (barcode, name, category_id, category_name, purchase_price, sale_price, stock, min_stock, supplier, supplier_id, unit_type, sellable_individually, units_per_package, individual_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(finalBarcode, name, category_id || null, categoryName, purchase_price || 0, sale_price, stock || 0, min_stock || 0, supplierName, supplier_id || null, unit_type || 'unit',
      sellable_individually ? 1 : 0, sellable_individually ? units_per_package : null, sellable_individually ? individual_price : null);

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
  const { name, barcode, category_id, purchase_price, sale_price, stock, min_stock, supplier, supplier_id, unit_type, sellable_individually, units_per_package, individual_price } = req.body;

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  if (barcode && barcode !== existing.barcode) {
    const dup = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(barcode, req.params.id);
    if (dup) return res.status(400).json({ error: 'Ya existe otro producto con ese código de barras' });
    const dupExtra = db.prepare('SELECT id FROM product_barcodes WHERE barcode = ?').get(barcode);
    if (dupExtra) return res.status(400).json({ error: 'Ese código ya está asignado como código adicional de otro producto' });
  }

  let finalSupplierId = existing.supplier_id;
  let finalSupplierName = existing.supplier;
  if (supplier_id !== undefined) {
    if (supplier_id) {
      const sup = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
      if (!sup) return res.status(400).json({ error: 'Proveedor no encontrado' });
      finalSupplierId = supplier_id;
      finalSupplierName = sup.name;
    } else {
      finalSupplierId = null;
      finalSupplierName = supplier !== undefined ? supplier : existing.supplier;
    }
  } else if (supplier !== undefined) {
    finalSupplierName = supplier;
  }

  const finalSellableIndividually = sellable_individually !== undefined ? !!sellable_individually : !!existing.sellable_individually;
  if (finalSellableIndividually) {
    const finalUnitsPerPackage = units_per_package !== undefined ? units_per_package : existing.units_per_package;
    const finalIndividualPrice = individual_price !== undefined ? individual_price : existing.individual_price;
    if (!finalUnitsPerPackage || finalUnitsPerPackage <= 0) {
      return res.status(400).json({ error: 'Indica cuántas unidades individuales trae cada paquete' });
    }
    if (!finalIndividualPrice || finalIndividualPrice <= 0) {
      return res.status(400).json({ error: 'Indica el precio de la unidad individual' });
    }
  }

  let categoryName = existing.category_name;
  if (category_id) {
    const cat = db.prepare('SELECT name FROM categories WHERE id = ?').get(category_id);
    if (cat) categoryName = cat.name;
  }

  // Editar y guardar el producto es justo la señal de que alguien ya revisó
  // sus datos — se le quita la marca de "faltan datos" (needs_review) que
  // pudo haberle puesto un import de formato desconocido (ver /import-excel).
  db.prepare(
    `UPDATE products SET name = ?, barcode = ?, category_id = ?, category_name = ?, purchase_price = ?, sale_price = ?, min_stock = ?, supplier = ?, supplier_id = ?, unit_type = ?,
     sellable_individually = ?, units_per_package = ?, individual_price = ?, needs_review = 0, updated_at = datetime("now")
     WHERE id = ?`
  ).run(
    name || existing.name,
    barcode || existing.barcode,
    category_id !== undefined ? category_id : existing.category_id,
    categoryName,
    purchase_price !== undefined ? purchase_price : existing.purchase_price,
    sale_price !== undefined ? sale_price : existing.sale_price,
    min_stock !== undefined ? min_stock : existing.min_stock,
    finalSupplierName,
    finalSupplierId,
    unit_type || existing.unit_type || 'unit',
    finalSellableIndividually ? 1 : 0,
    finalSellableIndividually ? (units_per_package !== undefined ? units_per_package : existing.units_per_package) : null,
    finalSellableIndividually ? (individual_price !== undefined ? individual_price : existing.individual_price) : null,
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

const DEFAULT_OBSOLETE_DAYS = 90;

router.get('/obsolete/settings', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'obsolete_inventory_days'").get();
  res.json({ days: row ? parseInt(row.value) : DEFAULT_OBSOLETE_DAYS });
});

router.put('/obsolete/settings', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  const days = parseInt(req.body.days);
  if (!days || days < 1) return res.status(400).json({ error: 'Periodo inválido' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('obsolete_inventory_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(days));
  res.json({ days });
});

// "No surtido" = sin movimiento de entrada (compra, lote, ajuste positivo,
// inventario inicial) en el periodo configurado. No mide ventas — un producto
// puede venderse bien y de todos modos llevar meses sin reabastecerse porque
// el proveedor lo descontinuó, que es justo el caso que esta pantalla ayuda
// a detectar antes de que el stock se agote silenciosamente o se acumule
// polvo en mercancía que ya nadie repone.
router.get('/obsolete', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const db = getDB();
  let days = parseInt(req.query.days);
  if (!days || days < 1) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'obsolete_inventory_days'").get();
    days = row ? parseInt(row.value) : DEFAULT_OBSOLETE_DAYS;
  }

  const products = db.prepare(
    `SELECT p.*, COALESCE(c.name, p.category_name) as category_name,
       (SELECT MAX(created_at) FROM inventory_movements im WHERE im.product_id = p.id AND im.type = 'in') as last_restocked_at
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.active = 1
     ORDER BY p.name ASC`
  ).all();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const obsolete = products.filter(p => {
    const createdAt = new Date(p.created_at.replace(' ', 'T') + 'Z');
    if (createdAt > cutoff) return false; // producto nuevo, aún no le toca reabastecerse
    if (!p.last_restocked_at) return true; // nunca se ha reabastecido desde que se creó
    const lastRestock = new Date(p.last_restocked_at.replace(' ', 'T') + 'Z');
    return lastRestock <= cutoff;
  });

  res.json({ days, products: obsolete });
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

router.get('/export-excel', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  try {
    const db = getDB();
    const list = db.prepare(
      `SELECT p.*, COALESCE(c.name, p.category_name) as category_name
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       ORDER BY p.name ASC`
    ).all();

    const rows = list.map(p => ({
      'Código de Barras': p.barcode || '',
      'Nombre': p.name,
      'Categoría': p.category_name || '',
      'Precio Compra': p.purchase_price || 0,
      'Precio Venta': p.sale_price || 0,
      'Stock': p.stock || 0,
      'Stock Mínimo': p.min_stock || 0,
      'Proveedor': p.supplier || '',
      'Tipo Unidad': unitTypeToLabel(p.unit_type),
      'Activo': p.active ? 'Sí' : 'No',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="inventario_${dateStr}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Error al exportar inventario: ' + e.message });
  }
});

// Tres formatos reconocidos:
//  - Propio (encabezados en español por nombre de columna: "Nombre", "Código
//    de Barras", etc.), pensado para ida y vuelta con /export-excel.
//  - El del sistema anterior de la tienda (hoja "Articulos", columnas por
//    posición: ARTÍCULO, DESCRIPCIÓN, LINEA...), que es el que de verdad usa
//    la tienda para sus exports periódicos de inventario — mismo layout que
//    lee scripts/import_excel.js.
//  - Cualquier otro Excel de inventario: se detectan las columnas por
//    parecido de nombre (sinónimos comunes), sin importar orden ni
//    encabezados exactos. Lo que no se logre identificar queda vacío/0 en
//    vez de descartar la fila, y el producto se marca (needs_review) para
//    que aparezca hasta arriba del inventario y alguien complete los datos
//    a mano — mejor tenerlo incompleto que no tenerlo.
// Los tres terminan en la misma fila normalizada para compartir el resto de
// la lógica (upsert, categorías, desactivación).
function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeHeader(h) {
  // Quita puntuación ("Cod. Barras" -> "COD BARRAS") para que las coincidencias
  // por "contiene" no fallen solo por un punto o un espacio doble de más.
  return stripAccents(h).trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLegacyRow(row) {
  const blocked = parseInt(row[16]) || 0;
  return {
    barcode: (row[0] || '').toString().trim(),
    name: (row[1] || '').toString().trim(),
    categoryName: (row[2] || '').toString().trim(),
    salePrice: parseFloat(row[4]) || 0,
    purchasePrice: parseFloat(row[7]) || 0,
    unitTypeRaw: row[9],
    minStock: parseFloat(row[10]) || 0,
    supplier: (row[17] || '').toString().trim(),
    stock: parseFloat(row[22]) || 0,
    active: blocked === 1 ? 0 : 1,
    needsReview: false
  };
}

function normalizeOwnRow(row) {
  const activeVal = String(row['Activo'] ?? 'Sí').trim().toLowerCase();
  return {
    barcode: String(row['Código de Barras'] ?? '').trim(),
    name: String(row['Nombre'] ?? '').trim(),
    categoryName: String(row['Categoría'] ?? '').trim(),
    salePrice: parseFloat(row['Precio Venta']) || 0,
    purchasePrice: parseFloat(row['Precio Compra']) || 0,
    unitTypeRaw: row['Tipo Unidad'],
    minStock: parseFloat(row['Stock Mínimo']) || 0,
    supplier: String(row['Proveedor'] ?? '').trim(),
    stock: parseFloat(row['Stock']) || 0,
    active: (activeVal === 'no' || activeVal === '0' || activeVal === 'false') ? 0 : 1,
    needsReview: false
  };
}

// Sinónimos en orden de prioridad — el primero que coincida gana. "ARTICULO"
// aparece al final tanto en nombre como en código de barras a propósito: es
// ambiguo (en el formato legado significa código, coloquialmente puede
// referirse al producto), así que solo se usa como último recurso.
const FUZZY_SYNONYMS = {
  barcode: ['CODIGO DE BARRAS', 'CODIGO BARRAS', 'COD BARRAS', 'SKU', 'EAN', 'CLAVE', 'CODIGO', 'ARTICULO'],
  name: ['NOMBRE', 'DESCRIPCION', 'PRODUCTO', 'ARTICULO'],
  category: ['CATEGORIA', 'LINEA', 'FAMILIA', 'DEPARTAMENTO', 'RUBRO'],
  purchase_price: ['PRECIO DE COMPRA', 'PRECIO COMPRA', 'COSTO UNITARIO', 'COSTO_U', 'COSTO'],
  sale_price: ['PRECIO DE VENTA', 'PRECIO VENTA', 'PVP', 'P VENTA', 'PRECIO'],
  stock: ['EXISTENCIAS', 'EXISTENCIA', 'STOCK', 'CANTIDAD', 'INVENTARIO'],
  min_stock: ['STOCK MINIMO', 'STOCK MIN', 'MINIMO'],
  supplier: ['PROVEEDOR', 'FABRICANTE'],
  unit_type: ['TIPO UNIDAD', 'UNIDAD', 'TIPO']
};

function findColumn(headerNorm, synonyms, used) {
  for (const syn of synonyms) {
    const idx = headerNorm.findIndex((h, i) => !used.has(i) && h === syn);
    if (idx !== -1) return idx;
  }
  for (const syn of synonyms) {
    const idx = headerNorm.findIndex((h, i) => !used.has(i) && h.includes(syn));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Se resuelven primero los campos con sinónimos específicos y sin ambigüedad
// (precio, stock, categoría...), y "name"/"barcode" al final — son los que
// comparten el sinónimo comodín "ARTICULO" como último recurso, y para
// entonces las columnas ya usadas por otros campos quedan excluidas, así que
// no se pisan entre sí ni le quitan la columna a un campo más específico.
const FUZZY_FIELD_ORDER = ['sale_price', 'purchase_price', 'stock', 'min_stock', 'category', 'supplier', 'unit_type', 'name', 'barcode'];

function detectFuzzyMapping(headerRowRaw) {
  const headerNorm = headerRowRaw.map(normalizeHeader);
  const mapping = {};
  const used = new Set();
  for (const field of FUZZY_FIELD_ORDER) {
    const idx = findColumn(headerNorm, FUZZY_SYNONYMS[field], used);
    if (idx !== -1) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

function normalizeFuzzyRow(row, mapping) {
  const get = (field) => (mapping[field] !== undefined ? row[mapping[field]] : undefined);
  const name = String(get('name') ?? '').trim();
  const barcode = String(get('barcode') ?? '').trim();
  const categoryName = String(get('category') ?? '').trim();
  const salePrice = parseFloat(get('sale_price'));
  const purchasePrice = parseFloat(get('purchase_price'));
  const stock = parseFloat(get('stock'));
  const minStock = parseFloat(get('min_stock'));
  const supplier = String(get('supplier') ?? '').trim();

  return {
    barcode,
    name,
    categoryName,
    salePrice: isNaN(salePrice) ? 0 : salePrice,
    purchasePrice: isNaN(purchasePrice) ? 0 : purchasePrice,
    unitTypeRaw: get('unit_type'),
    minStock: isNaN(minStock) ? 0 : minStock,
    supplier,
    stock: isNaN(stock) ? 0 : stock,
    // Formato desconocido: no hay forma confiable de interpretar una columna
    // de "activo"/"bloqueado" (los valores podrían significar cualquier
    // cosa), así que se importa siempre activo en vez de arriesgarse a
    // desactivar de más.
    active: 1,
    needsReview: !categoryName || isNaN(salePrice) || salePrice <= 0
  };
}

router.post('/import-excel', authMiddleware, inventoryAdminMiddleware, (req, res) => {
  const { fileBase64 } = req.body;
  if (!fileBase64) return res.status(400).json({ error: 'Archivo requerido' });

  let normalizedRows;
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.includes('Inventario') ? 'Inventario' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return res.status(400).json({ error: 'El archivo no tiene hojas' });

    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const headerRowRaw = rawRows[0] || [];
    const headerNorm = headerRowRaw.map(normalizeHeader);
    const isLegacyFormat = headerNorm.includes('ARTICULO') || headerNorm.includes('DESCRIPCION');
    const isOwnFormat = headerNorm.includes('NOMBRE') && (headerNorm.includes('CODIGO DE BARRAS') || headerNorm.includes('PRECIO VENTA'));

    if (isLegacyFormat) {
      normalizedRows = rawRows.slice(1).filter(r => r[0] || r[1]).map(normalizeLegacyRow);
    } else if (isOwnFormat) {
      normalizedRows = XLSX.utils.sheet_to_json(ws, { defval: '' }).map(normalizeOwnRow);
    } else {
      const mapping = detectFuzzyMapping(headerRowRaw);
      normalizedRows = rawRows.slice(1)
        .filter(r => r.some(c => String(c ?? '').trim() !== ''))
        .map(r => normalizeFuzzyRow(r, mapping));
    }
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo leer el archivo Excel: ' + e.message });
  }

  const db = getDB();
  let inserted = 0, updated = 0, deactivated = 0, skipped = 0, needsReviewCount = 0;

  const transaction = db.transaction(() => {
    const seenBarcodes = new Set();
    const categoryCache = {};

    function resolveCategory(name) {
      const trimmed = (name || '').toString().trim();
      if (!trimmed) return { id: null, name: null };
      if (categoryCache[trimmed]) return categoryCache[trimmed];
      let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmed);
      if (!cat) {
        const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed);
        cat = { id: result.lastInsertRowid };
      }
      const resolved = { id: cat.id, name: trimmed };
      categoryCache[trimmed] = resolved;
      return resolved;
    }

    for (const row of normalizedRows) {
      const name = row.name;
      if (!name) { skipped++; continue; }

      let barcode = row.barcode;
      if (!barcode) {
        barcode = 'BAR-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
      }

      const category = resolveCategory(row.categoryName);
      const purchasePrice = row.purchasePrice;
      const salePrice = row.salePrice;
      const stock = row.stock;
      const minStock = row.minStock;
      const supplier = row.supplier || null;
      const unitType = labelToUnitType(row.unitTypeRaw);
      const active = row.active;
      const needsReview = row.needsReview ? 1 : 0;
      if (needsReview) needsReviewCount++;

      seenBarcodes.add(barcode);

      const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
      if (existing) {
        db.prepare(
          `UPDATE products SET name=?, category_id=?, category_name=?, purchase_price=?, sale_price=?, stock=?, min_stock=?, supplier=?, unit_type=?, active=?, needs_review=?, updated_at=datetime('now') WHERE id=?`
        ).run(name, category.id, category.name, purchasePrice, salePrice, stock, minStock, supplier, unitType, active, needsReview, existing.id);
        updated++;
      } else {
        db.prepare(
          `INSERT INTO products (barcode, name, category_id, category_name, purchase_price, sale_price, stock, min_stock, supplier, unit_type, active, needs_review) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(barcode, name, category.id, category.name, purchasePrice, salePrice, stock, minStock, supplier, unitType, active, needsReview);
        inserted++;
      }
    }

    // Si no se reconoció ni una sola fila (formato de archivo no soportado,
    // hoja vacía, etc.) NUNCA se debe desactivar nada — de lo contrario un
    // archivo que no se pudo leer se interpreta como "el inventario está
    // vacío" y borra de un plumazo el catálogo activo completo. Esto pasó de
    // verdad: un archivo con encabezados no reconocidos desactivó los 222
    // productos de la tienda porque ninguna fila "apareció" en el archivo.
    if (inserted === 0 && updated === 0) {
      throw new Error('No se reconoció ninguna fila del archivo. Revisa que sea un Excel de inventario válido (o que la hoja no esté vacía) — no se modificó nada.');
    }

    // Cualquier producto activo con código de barras que no haya aparecido en
    // el archivo se desactiva (nunca se borra) — el Excel importado se trata
    // como la fuente de verdad del catálogo activo. Los productos sin código
    // de barras en la BD quedan fuera de esta reconciliación porque no hay
    // forma confiable de saber si "no aparecieron" o simplemente nunca
    // tuvieron uno que exportar.
    const activeWithBarcode = db.prepare("SELECT id, barcode FROM products WHERE active = 1 AND barcode IS NOT NULL AND barcode != ''").all();
    const deactivateStmt = db.prepare('UPDATE products SET active = 0, updated_at = datetime(\'now\') WHERE id = ?');
    for (const p of activeWithBarcode) {
      if (!seenBarcodes.has(p.barcode)) {
        deactivateStmt.run(p.id);
        deactivated++;
      }
    }
  });

  try {
    transaction();
  } catch (e) {
    return res.status(500).json({ error: 'Error al importar: ' + e.message });
  }

  res.json({ inserted, updated, deactivated, skipped, needsReview: needsReviewCount });
});

module.exports = router;
