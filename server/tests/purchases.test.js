// Test profundo del flujo de compras a proveedores (que no tenía ninguna
// cobertura) + validaciones de endurecimiento: pedido → recepción con
// diferencias → stock/costo/gasto → cancelación con reversa, búsqueda por
// proveedor, y los guardas de datos inválidos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-purchases-test-'));
const TEST_PORT = 5200 + (process.pid % 300);
process.env.TIENDA_DB_PATH = path.join(tmpDir, 'tienda.db');
process.env.PORT = String(TEST_PORT);
process.env.SKIP_SEED_IMPORT = 'true';

const serverModule = require('../index.js');

const BASE = `http://127.0.0.1:${TEST_PORT}/api`;

test.after(() => {
  const server = serverModule.getHttpServer();
  if (server) server.close();
});

async function api(endpoint, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + endpoint, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json };
}

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(BASE + '/network-info');
      if (res.ok) return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('El servidor no arrancó en el puerto de prueba');
}

test('compras a proveedores y endurecimiento', async (t) => {
  await waitForServer();

  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(login.status, 200);
  const admin = login.body.token;

  // --- Setup: proveedor + producto vinculado ---
  const supRes = await api('/suppliers', { method: 'POST', token: admin, body: { name: 'Proveedor Compras Test' } });
  assert.strictEqual(supRes.status, 200);
  const supplierId = supRes.body.id;

  const prodRes = await api('/products', {
    method: 'POST', token: admin,
    body: { name: 'Aceite Test', sale_price: 45, purchase_price: 30, stock: 2, min_stock: 5, supplier_id: supplierId },
  });
  assert.strictEqual(prodRes.status, 201);
  const productId = prodRes.body.id;
  assert.strictEqual(prodRes.body.supplier_id, supplierId);

  await t.test('la búsqueda por proveedor encuentra sus productos (suggested-order)', async () => {
    // stock 2 <= min 5 → el fallback de bajo stock sugiere reponer
    const order = await api(`/suppliers/${supplierId}/suggested-order`, { token: admin });
    assert.strictEqual(order.status, 200);
    assert.ok(order.body.items.length >= 1, 'debe sugerir el producto bajo de stock');
    assert.strictEqual(order.body.items[0].product_id, productId);
  });

  await t.test('rechaza compra con cantidad negativa o precio inválido', async () => {
    const neg = await api('/purchases', {
      method: 'POST', token: admin,
      body: { supplier_id: supplierId, items: [{ product_id: productId, product_name: 'Aceite Test', quantity: -5, unit_price: 30 }] },
    });
    assert.strictEqual(neg.status, 400);

    const badPrice = await api('/purchases', {
      method: 'POST', token: admin,
      body: { supplier_id: supplierId, items: [{ product_id: productId, product_name: 'Aceite Test', quantity: 5, unit_price: -1 }] },
    });
    assert.strictEqual(badPrice.status, 400);
  });

  let pendingId;
  await t.test('pedido pendiente: no toca stock ni registra gasto', async () => {
    const res = await api('/purchases', {
      method: 'POST', token: admin,
      body: { supplier_id: supplierId, status: 'pending', invoice_number: 'F-001', items: [{ product_id: productId, product_name: 'Aceite Test', quantity: 10, unit_price: 28 }] },
    });
    assert.strictEqual(res.status, 200);
    pendingId = res.body.id;
    assert.ok(pendingId, 'debe devolver el id del pedido');

    const prod = await api(`/products/barcode/${prodRes.body.barcode}`, { token: admin });
    assert.strictEqual(prod.body.stock, 2, 'un pedido pendiente no inventaría nada');
  });

  await t.test('recepción con diferencias: stock, costo y gasto usan lo RECIBIDO', async () => {
    // Pedimos 10 a $28; llegaron 8 a $29
    const rec = await api(`/purchases/${pendingId}/receive`, {
      method: 'PUT', token: admin,
      body: { items: [{ id: (await api(`/purchases/${pendingId}`, { token: admin })).body.items[0].id, received_quantity: 8, received_unit_price: 29 }] },
    });
    assert.strictEqual(rec.status, 200);

    const prod = await api(`/products/barcode/${prodRes.body.barcode}`, { token: admin });
    assert.strictEqual(prod.body.stock, 10, 'stock 2 + 8 recibidas');
    assert.strictEqual(prod.body.purchase_price, 29, 'el costo se actualiza al precio recibido');

    const purchase = await api(`/purchases/${pendingId}`, { token: admin });
    assert.strictEqual(purchase.body.status, 'completed');
    const expectedTotal = Math.round(8 * 29 * 1.16 * 100) / 100;
    assert.ok(Math.abs(purchase.body.total - expectedTotal) < 0.01, 'el total se recalcula con lo recibido');

    // El gasto en contabilidad existe y referencia la compra
    const expenses = await api('/accounting/expenses?limit=10', { token: admin });
    const linked = expenses.body.expenses.find(e => e.reference_type === 'purchase' && e.reference_id === pendingId);
    assert.ok(linked, 'la compra recibida debe aparecer como gasto');
    assert.ok(Math.abs(linked.amount - expectedTotal) < 0.01);
  });

  await t.test('rechaza recepción con cantidades negativas', async () => {
    const p2 = await api('/purchases', {
      method: 'POST', token: admin,
      body: { supplier_id: supplierId, status: 'pending', items: [{ product_id: productId, product_name: 'Aceite Test', quantity: 3, unit_price: 28 }] },
    });
    const itemId = (await api(`/purchases/${p2.body.id}`, { token: admin })).body.items[0].id;
    const rec = await api(`/purchases/${p2.body.id}/receive`, {
      method: 'PUT', token: admin,
      body: { items: [{ id: itemId, received_quantity: -3, received_unit_price: 28 }] },
    });
    assert.strictEqual(rec.status, 400);
    // el pedido sigue pendiente y cancelable
    await api(`/purchases/${p2.body.id}`, { method: 'DELETE', token: admin });
  });

  await t.test('cancelar compra recibida revierte stock y elimina el gasto', async () => {
    const del = await api(`/purchases/${pendingId}`, { method: 'DELETE', token: admin });
    assert.strictEqual(del.status, 200);

    const prod = await api(`/products/barcode/${prodRes.body.barcode}`, { token: admin });
    assert.strictEqual(prod.body.stock, 2, 'las 8 recibidas se revierten');

    const expenses = await api('/accounting/expenses?limit=10', { token: admin });
    const linked = expenses.body.expenses.find(e => e.reference_type === 'purchase' && e.reference_id === pendingId);
    assert.ok(!linked, 'el gasto de la compra cancelada desaparece');
  });

  await t.test('cancelar compra inexistente da 404 (no crash) y doble cancelación da 400', async () => {
    const notFound = await api('/purchases/99999', { method: 'DELETE', token: admin });
    assert.strictEqual(notFound.status, 404);

    const twice = await api(`/purchases/${pendingId}`, { method: 'DELETE', token: admin });
    assert.strictEqual(twice.status, 400);
  });

  // --- Endurecimiento general ---

  await t.test('producto con precio o stock negativo se rechaza (alta y edición)', async () => {
    const negPrice = await api('/products', { method: 'POST', token: admin, body: { name: 'Malo', sale_price: -10 } });
    assert.strictEqual(negPrice.status, 400);

    const negStockEdit = await api(`/products/${productId}`, { method: 'PUT', token: admin, body: { stock: -4 } });
    assert.strictEqual(negStockEdit.status, 400);
  });

  await t.test('no se puede degradar al último admin', async () => {
    const demote = await api('/auth/users/1', { method: 'PUT', token: admin, body: { role: 'cashier' } });
    assert.strictEqual(demote.status, 400);
    assert.match(demote.body.error, /último admin/);
  });

  await t.test('cierre de caja con monto negativo o no numérico se rechaza', async () => {
    const neg = await api('/accounting/cash-register', { method: 'PUT', token: admin, body: { closing_amount: -50 } });
    assert.strictEqual(neg.status, 400);
    const nan = await api('/accounting/cash-register', { method: 'PUT', token: admin, body: { closing_amount: 'abc' } });
    assert.strictEqual(nan.status, 400);
  });

  await t.test('el filtro dateTo del historial también aplica a los cortes', async () => {
    // Cerrar la caja de hoy para que exista un corte 'closed'
    await api('/accounting/cash-register', { method: 'PUT', token: admin, body: { closing_amount: 0 } });
    const all = await api('/accounting/history', { token: admin });
    assert.ok(all.body.registers.length >= 1, 'debe existir el corte de hoy');
    const filtered = await api('/accounting/history?dateTo=2000-01-01', { token: admin });
    assert.strictEqual(filtered.body.registers.length, 0, 'con dateTo en el pasado no debe salir ningún corte');
  });
});
