// Tests de la Fase B: cuentas por pagar a proveedores (B1), utilidad por
// producto/categoría (B2), historial de precios (B4) y corte ciego (B5).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-phaseb-test-'));
const TEST_PORT = 5600 + (process.pid % 300);
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
    method, headers,
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

test('Fase B', async (t) => {
  await waitForServer();

  const adminLogin = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const admin = adminLogin.body.token;
  const cashierLogin = await api('/auth/login', { method: 'POST', body: { username: 'cajero', password: 'cajero123' } });
  const cashier = cashierLogin.body.token;

  const sup = await api('/suppliers', { method: 'POST', token: admin, body: { name: 'Proveedor Credito' } });
  const supplierId = sup.body.id;
  const prod = await api('/products', {
    method: 'POST', token: admin,
    body: { name: 'Jugo Test B', sale_price: 50, purchase_price: 30, stock: 10, supplier_id: supplierId },
  });
  const productId = prod.body.id;

  // Abrir caja
  await api('/accounting/cash-register', { method: 'PUT', token: admin, body: { opening_amount: 100 } });

  // ============ B1: cuentas por pagar ============
  let creditId;
  await t.test('B1: compra a crédito NO genera gasto al recibirla, pero sí stock', async () => {
    const res = await api('/purchases', {
      method: 'POST', token: admin,
      body: {
        supplier_id: supplierId, status: 'completed', payment_type: 'credit', due_date: '2030-01-15',
        items: [{ product_id: productId, product_name: 'Jugo Test B', quantity: 10, unit_price: 30 }],
      },
    });
    assert.strictEqual(res.status, 200);
    creditId = res.body.id;

    const p = await api(`/products/barcode/${prod.body.barcode}`, { token: admin });
    assert.strictEqual(p.body.stock, 20, 'el stock sí entra (10 + 10)');

    const expenses = await api('/accounting/expenses?limit=20', { token: admin });
    const linked = expenses.body.expenses.find(e => e.reference_type === 'purchase' && e.reference_id === creditId);
    assert.ok(!linked, 'a crédito no debe haber gasto todavía');

    const reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 100, 'el cajón no se toca en una compra a crédito');
  });

  const creditTotal = Math.round(10 * 30 * 1.16 * 100) / 100; // 348

  await t.test('B1: la deuda aparece en cuentas por pagar', async () => {
    const ap = await api('/accounts-payable', { token: admin });
    assert.strictEqual(ap.status, 200);
    assert.ok(Math.abs(ap.body.total_owed - creditTotal) < 0.01);
    assert.strictEqual(ap.body.suppliers[0].supplier_name, 'Proveedor Credito');
    assert.strictEqual(ap.body.purchases[0].id, creditId);
  });

  await t.test('B1: no se puede cancelar una compra con pagos, ni pagar de más', async () => {
    const over = await api(`/purchases/${creditId}/payments`, { method: 'POST', token: admin, body: { amount: 9999 } });
    assert.strictEqual(over.status, 400, 'pagar más que el saldo se rechaza');

    const pay = await api(`/purchases/${creditId}/payments`, { method: 'POST', token: admin, body: { amount: 100, payment_method: 'cash' } });
    assert.strictEqual(pay.status, 201);
    assert.ok(Math.abs(pay.body.balance - (creditTotal - 100)) < 0.01);

    const cancel = await api(`/purchases/${creditId}`, { method: 'DELETE', token: admin });
    assert.strictEqual(cancel.status, 400, 'con pagos registrados no se cancela');
  });

  await t.test('B1: el pago genera gasto y sale del cajón; liquidar deja la deuda en 0', async () => {
    const expenses = await api('/accounting/expenses?limit=20', { token: admin });
    const payExp = expenses.body.expenses.find(e => e.reference_type === 'purchase_payment');
    assert.ok(payExp, 'el pago debe aparecer como gasto');
    assert.strictEqual(payExp.amount, 100);

    const reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 0, '100 apertura - 100 pagados al proveedor');

    const rest = await api(`/purchases/${creditId}/payments`, { method: 'POST', token: admin, body: { amount: creditTotal - 100, payment_method: 'transfer' } });
    assert.strictEqual(rest.status, 201);
    assert.ok(Math.abs(rest.body.balance) < 0.01, 'saldo liquidado');

    const ap = await api('/accounts-payable', { token: admin });
    assert.strictEqual(ap.body.purchases.length, 0, 'ya no debe nada');

    const reg2 = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg2.body.expectedCash, 0, 'el pago por transferencia no toca el cajón');
  });

  await t.test('B1: eliminar un pago (solo admin) revierte saldo y gasto', async () => {
    const pays = await api(`/purchases/${creditId}/payments`, { token: admin });
    assert.strictEqual(pays.body.payments.length, 2);
    const first = pays.body.payments[0];

    const asCashier = await api(`/purchases/payments/${first.id}`, { method: 'DELETE', token: cashier });
    assert.strictEqual(asCashier.status, 403);

    const del = await api(`/purchases/payments/${first.id}`, { method: 'DELETE', token: admin });
    assert.strictEqual(del.status, 200);

    const ap = await api('/accounts-payable', { token: admin });
    assert.ok(Math.abs(ap.body.total_owed - 100) < 0.01, 'la deuda regresa por el monto del pago eliminado');

    const reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 100, 'el efectivo del pago eliminado regresa al esperado');
  });

  // ============ B2: utilidad por producto ============
  await t.test('B2: utilidad por producto y por categoría con math correcta', async () => {
    // Venta: 2 x $50, costo $30 c/u → utilidad $40
    const sale = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: 2, unit_price: 50 }], payments: [{ method: 'cash', amount: 100 }] },
    });
    assert.strictEqual(sale.status, 201);

    const byProd = await api('/profit-by-product' === '' ? '' : '/accounting/profit-by-product', { token: admin });
    assert.strictEqual(byProd.status, 200);
    const row = byProd.body.rows.find(r => r.product_id === productId);
    assert.ok(row, 'el producto vendido aparece');
    assert.strictEqual(row.qty_sold, 2);
    assert.strictEqual(row.revenue, 100);
    assert.strictEqual(row.cost, 60);
    assert.strictEqual(row.profit, 40);
    assert.strictEqual(row.margin_pct, 40);

    const byCat = await api('/accounting/profit-by-product?groupBy=category', { token: admin });
    assert.ok(byCat.body.rows.length >= 1);

    const asCashier = await api('/accounting/profit-by-product', { token: cashier });
    assert.strictEqual(asCashier.status, 403, 'el cajero no ve utilidades');
  });

  // ============ B4: historial de precios ============
  await t.test('B4: los cambios de precio quedan registrados con origen', async () => {
    await api(`/products/${productId}`, { method: 'PUT', token: admin, body: { sale_price: 55 } });
    // Guardar sin cambiar nada no debe agregar ruido
    await api(`/products/${productId}`, { method: 'PUT', token: admin, body: { sale_price: 55 } });

    const hist = await api(`/products/${productId}/price-history`, { token: admin });
    assert.strictEqual(hist.status, 200);
    const saleChanges = hist.body.history.filter(h => h.field === 'sale_price');
    assert.strictEqual(saleChanges.length, 1, 'solo el cambio real, sin duplicado');
    assert.strictEqual(saleChanges[0].old_value, 50);
    assert.strictEqual(saleChanges[0].new_value, 55);
    assert.strictEqual(saleChanges[0].source, 'edición manual');
  });

  await t.test('B4: la recepción de compra registra el cambio de costo', async () => {
    // A crédito para que este pedido no meta movimientos de efectivo (el
    // test de corte ciego de abajo depende del esperado en este punto).
    const order = await api('/purchases', {
      method: 'POST', token: admin,
      body: { supplier_id: supplierId, status: 'pending', payment_type: 'credit', items: [{ product_id: productId, product_name: 'Jugo Test B', quantity: 5, unit_price: 32 }] },
    });
    const itemId = (await api(`/purchases/${order.body.id}`, { token: admin })).body.items[0].id;
    await api(`/purchases/${order.body.id}/receive`, {
      method: 'PUT', token: admin,
      body: { items: [{ id: itemId, received_quantity: 5, received_unit_price: 32 }] },
    });

    const hist = await api(`/products/${productId}/price-history`, { token: admin });
    const costChange = hist.body.history.find(h => h.field === 'purchase_price' && /recepción/.test(h.source || ''));
    assert.ok(costChange, 'el cambio de costo por recepción queda en el historial');
    assert.strictEqual(costChange.old_value, 30);
    assert.strictEqual(costChange.new_value, 32);
  });

  // ============ B5: corte ciego ============
  await t.test('B5: el cajero NO ve el efectivo esperado; el admin sí', async () => {
    const asAdmin = await api('/accounting/cash-register', { token: admin });
    assert.ok(asAdmin.body.expectedCash !== undefined, 'el admin ve expectedCash');

    const asCashier = await api('/accounting/cash-register', { token: cashier });
    assert.strictEqual(asCashier.body.expectedCash, undefined, 'el cajero no recibe expectedCash (corte ciego)');
    assert.ok(asCashier.body.date, 'el resto de la caja sí lo ve');
  });

  await t.test('B5: la diferencia se guarda de todos modos al cerrar', async () => {
    // El cajero cierra contando $80 (esperado real: 100 apertura + 100 venta - 100 pago = 100)
    const close = await api('/accounting/cash-register', { method: 'PUT', token: cashier, body: { closing_amount: 80 } });
    assert.strictEqual(close.status, 200);
    // El registro guarda el esperado y la diferencia para el dueño
    assert.strictEqual(close.body.expected_amount, 200);
    assert.strictEqual(close.body.difference, -120);
  });
});
