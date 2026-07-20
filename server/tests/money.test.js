// Tests de integración de las rutas de dinero: venta, validaciones, corte de
// caja (efectivo esperado), retiros, cancelaciones y permisos por rol.
// Arranca el servidor real contra una base de datos temporal (TIENDA_DB_PATH)
// y le pega por HTTP con fetch — sin dependencias externas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-money-test-'));
// Puerto derivado del PID: si quedara colgado un proceso de una corrida
// anterior, esta corrida no le pegaría por accidente a ese servidor viejo.
const TEST_PORT = 4100 + (process.pid % 500);
process.env.TIENDA_DB_PATH = path.join(tmpDir, 'tienda.db');
process.env.PORT = String(TEST_PORT);
process.env.SKIP_SEED_IMPORT = 'true';

const serverModule = require('../index.js');

const BASE = `http://127.0.0.1:${TEST_PORT}/api`;

// Cerrar el servidor al terminar para que el proceso de prueba pueda salir.
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

test('rutas de dinero', async (t) => {
  await waitForServer();

  // --- Login ---
  const adminLogin = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(adminLogin.status, 200);
  assert.strictEqual(adminLogin.body.must_change_password, true, 'login con contraseña de fábrica debe pedir cambio');
  const admin = adminLogin.body.token;

  const cashierLogin = await api('/auth/login', { method: 'POST', body: { username: 'cajero', password: 'cajero123' } });
  assert.strictEqual(cashierLogin.status, 200);
  const cashier = cashierLogin.body.token;

  // --- Producto de prueba ---
  const prodRes = await api('/products', {
    method: 'POST', token: admin,
    body: { name: 'Refresco Test', sale_price: 50, purchase_price: 30, stock: 10 },
  });
  assert.strictEqual(prodRes.status, 201);
  const productId = prodRes.body.id;

  // --- Apertura de caja con $100 ---
  const openReg = await api('/accounting/cash-register', { method: 'PUT', token: admin, body: { opening_amount: 100 } });
  assert.strictEqual(openReg.status, 200);

  await t.test('rechaza cantidad negativa', async () => {
    const res = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: -5, unit_price: 50 }], payments: [{ method: 'cash', amount: -250 }] },
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('rechaza pagos que no cubren el total', async () => {
    const res = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: 1, unit_price: 50 }], payments: [{ method: 'cash', amount: 20 }] },
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /no cubren/);
  });

  await t.test('rechaza excedente sin efectivo (no hay cambio con tarjeta)', async () => {
    const res = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: 1, unit_price: 50 }], payments: [{ method: 'card', amount: 80 }] },
    });
    assert.strictEqual(res.status, 400);
  });

  let cashSaleId;
  await t.test('venta en efectivo con cambio: al cajón entra solo el neto', async () => {
    // Total $100 (2 x $50), cliente paga con billete de $150 → cambio $50.
    const res = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: 2, unit_price: 50 }], payments: [{ method: 'cash', amount: 150 }] },
    });
    assert.strictEqual(res.status, 201);
    cashSaleId = res.body.sale.id;

    const reg = await api('/accounting/cash-register', { token: admin });
    // 100 apertura + 100 efectivo neto de la venta
    assert.strictEqual(reg.body.expectedCash, 200);
  });

  await t.test('venta con tarjeta no toca el efectivo esperado', async () => {
    const res = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: 1, unit_price: 50 }], payments: [{ method: 'card', amount: 50 }] },
    });
    assert.strictEqual(res.status, 201);

    const reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 200, 'la venta con tarjeta no debe sumar al cajón');
  });

  await t.test('venta mixta suma solo la parte en efectivo', async () => {
    // Total $50: $30 efectivo + $20 tarjeta
    const res = await api('/sales', {
      method: 'POST', token: admin,
      body: { items: [{ product_id: productId, quantity: 1, unit_price: 50 }], payments: [{ method: 'cash', amount: 30 }, { method: 'card', amount: 20 }] },
    });
    assert.strictEqual(res.status, 201);

    const reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 230);
  });

  await t.test('retiro de efectivo baja el esperado; cajero no puede cancelarlo', async () => {
    const w = await api('/accounting/withdrawals', { method: 'POST', token: admin, body: { amount: 30, reason: 'Pago proveedor' } });
    assert.strictEqual(w.status, 201);

    const reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 200);

    const cancelAsCashier = await api(`/accounting/withdrawals/${w.body.id}/cancel`, { method: 'PUT', token: cashier });
    assert.strictEqual(cancelAsCashier.status, 403);

    const cancelAsAdmin = await api(`/accounting/withdrawals/${w.body.id}/cancel`, { method: 'PUT', token: admin });
    assert.strictEqual(cancelAsAdmin.status, 200);

    const cancelTwice = await api(`/accounting/withdrawals/${w.body.id}/cancel`, { method: 'PUT', token: admin });
    assert.strictEqual(cancelTwice.status, 400, 'un retiro no se puede cancelar dos veces');

    const regAfter = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(regAfter.body.expectedCash, 230);
  });

  await t.test('cancelar venta: prohibido para cajero, admin devuelve stock y efectivo', async () => {
    const asCashier = await api(`/sales/${cashSaleId}/cancel`, { method: 'POST', token: cashier, body: { reason: 'test' } });
    assert.strictEqual(asCashier.status, 403);

    const before = await api(`/products/barcode/${prodRes.body.barcode}`, { token: admin });
    const stockBefore = before.body.stock;

    const asAdmin = await api(`/sales/${cashSaleId}/cancel`, { method: 'POST', token: admin, body: { reason: 'Devolución de prueba' } });
    assert.strictEqual(asAdmin.status, 200);

    const after = await api(`/products/barcode/${prodRes.body.barcode}`, { token: admin });
    assert.strictEqual(after.body.stock, stockBefore + 2, 'el stock de la venta cancelada debe regresar');

    const reg = await api('/accounting/cash-register', { token: admin });
    // 230 - 100 de efectivo devuelto
    assert.strictEqual(reg.body.expectedCash, 130);
  });

  await t.test('gasto con tarjeta no afecta el cajón; en efectivo sí (y su borrado lo revierte)', async () => {
    const cardExp = await api('/accounting/expenses', { method: 'POST', token: admin, body: { description: 'Gasto tarjeta', amount: 40, payment_method: 'card' } });
    assert.strictEqual(cardExp.status, 201);
    let reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 130);

    const cashExp = await api('/accounting/expenses', { method: 'POST', token: admin, body: { description: 'Gasto efectivo', amount: 25 } });
    assert.strictEqual(cashExp.status, 201);
    reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 105);

    const del = await api(`/accounting/expenses/${cashExp.body.id}`, { method: 'DELETE', token: admin });
    assert.strictEqual(del.status, 200);
    reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 130, 'borrar el gasto debe revertir su movimiento de caja');
  });

  await t.test('abono de cliente en efectivo entra al cajón', async () => {
    const cust = await api('/customers', { method: 'POST', token: admin, body: { name: 'Cliente Test', credit_limit: 500 } });
    assert.strictEqual(cust.status, 201);

    const creditSale = await api('/sales', {
      method: 'POST', token: admin,
      body: {
        items: [{ product_id: productId, quantity: 1, unit_price: 50 }],
        payments: [{ method: 'credit', amount: 50 }],
        customer_id: cust.body.id, customer_name: cust.body.name,
      },
    });
    assert.strictEqual(creditSale.status, 201);

    let reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 130, 'la venta a fiado no mete efectivo');

    const payment = await api(`/customers/${cust.body.id}/payment`, { method: 'POST', token: admin, body: { amount: 50, payment_method: 'cash' } });
    assert.strictEqual(payment.status, 200);

    reg = await api('/accounting/cash-register', { token: admin });
    assert.strictEqual(reg.body.expectedCash, 180, 'el abono en efectivo debe sumar al cajón');
  });

  await t.test('cierre de caja: diferencia contra efectivo esperado real', async () => {
    const close = await api('/accounting/cash-register', { method: 'PUT', token: admin, body: { closing_amount: 180 } });
    assert.strictEqual(close.status, 200);
    assert.strictEqual(close.body.expected_amount, 180);
    assert.strictEqual(close.body.difference, 0, 'contando el efectivo real la diferencia debe ser 0');
  });

  await t.test('sesión de caja: nadie cierra el turno de otro (salvo admin)', async () => {
    const adminSession = await api('/accounting/sessions', { method: 'POST', token: admin, body: { opening_amount: 0 } });
    assert.strictEqual(adminSession.status, 200);

    const asCashier = await api(`/accounting/sessions/${adminSession.body.session.id}/close`, { method: 'PUT', token: cashier, body: { closing_amount: 0 } });
    assert.strictEqual(asCashier.status, 403);

    const asOwner = await api(`/accounting/sessions/${adminSession.body.session.id}/close`, { method: 'PUT', token: admin, body: { closing_amount: 0 } });
    assert.strictEqual(asOwner.status, 200);
  });
});
