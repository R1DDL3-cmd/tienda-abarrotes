// Tests de la edición masiva de productos (PUT /products/bulk): valor fijo,
// ajuste por porcentaje, cambio de categoría/proveedor/activo, registro en
// historial de precios, y que el orden de rutas no confunda "bulk" con un id.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-bulk-test-'));
const TEST_PORT = 5900 + (process.pid % 300);
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
  const res = await fetch(BASE + endpoint, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json };
}

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i++) {
    try { const res = await fetch(BASE + '/network-info'); if (res.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('El servidor no arrancó');
}

test('edición masiva de productos', async (t) => {
  await waitForServer();
  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const admin = login.body.token;

  const cat = await api('/products/categories', { method: 'POST', token: admin, body: { name: 'Promoción' } });
  const catId = cat.body.id;
  const sup = await api('/suppliers', { method: 'POST', token: admin, body: { name: 'Proveedor Bulk' } });
  const supId = sup.body.id;

  const ids = [];
  const barcodes = [];
  for (const [name, price] of [['Prod A', 10], ['Prod B', 20], ['Prod C', 40]]) {
    const r = await api('/products', { method: 'POST', token: admin, body: { name, sale_price: price, purchase_price: price / 2, stock: 5, min_stock: 2 } });
    ids.push(r.body.id);
    barcodes.push(r.body.barcode);
  }

  async function prod(i) {
    return (await api(`/products/barcode/${barcodes[i]}`, { token: admin })).body;
  }

  await t.test('la ruta /bulk no se confunde con /:id', async () => {
    // Sin cuerpo válido debe dar 400 del handler de bulk, no 404 de /:id
    const r = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids: [], changes: {} } });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Selecciona/);
  });

  await t.test('fijar el mismo precio de venta a varios', async () => {
    const r = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids, changes: { sale_price: 25 } } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.updated, 3);
    for (let i = 0; i < 3; i++) assert.strictEqual((await prod(i)).sale_price, 25);
  });

  await t.test('ajustar precio por porcentaje (+10%)', async () => {
    const r = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids, changes: { sale_price_pct: 10 } } });
    assert.strictEqual(r.status, 200);
    // 25 * 1.10 = 27.5 para todos
    for (let i = 0; i < 3; i++) assert.strictEqual((await prod(i)).sale_price, 27.5);
  });

  await t.test('cambiar categoría, proveedor y stock mínimo juntos', async () => {
    const r = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids, changes: { category_id: catId, supplier_id: supId, min_stock: 8 } } });
    assert.strictEqual(r.status, 200);
    const p = await prod(0);
    assert.strictEqual(p.category_name, 'Promoción');
    assert.strictEqual(p.supplier_id, supId);
    assert.strictEqual(p.min_stock, 8);
  });

  await t.test('desactivar varios productos a la vez', async () => {
    const r = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids: [ids[0], ids[1]], changes: { active: false } } });
    assert.strictEqual(r.status, 200);
    // Los desactivados ya no salen en /all (solo activos)
    const all = await api('/products/all', { token: admin });
    const activeIds = all.body.products.map(p => p.id);
    assert.ok(!activeIds.includes(ids[0]) && !activeIds.includes(ids[1]));
    assert.ok(activeIds.includes(ids[2]));
  });

  await t.test('los cambios de precio quedan en el historial', async () => {
    const hist = await api(`/products/${ids[2]}/price-history`, { token: admin });
    const bulkChanges = hist.body.history.filter(h => h.source === 'edición masiva' && h.field === 'sale_price');
    assert.ok(bulkChanges.length >= 2, 'el precio fijo y el ajuste por % quedaron registrados');
  });

  await t.test('rechaza porcentaje no numérico y precio negativo', async () => {
    const bad1 = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids, changes: { sale_price_pct: 'abc' } } });
    assert.strictEqual(bad1.status, 400);
    const bad2 = await api('/products/bulk', { method: 'PUT', token: admin, body: { ids, changes: { sale_price: -5 } } });
    assert.strictEqual(bad2.status, 400);
  });

  await t.test('el cajero no puede hacer edición masiva', async () => {
    const cl = await api('/auth/login', { method: 'POST', body: { username: 'cajero', password: 'cajero123' } });
    // must_change_password: cambiar primero
    let cToken = cl.body.token;
    await api('/auth/password', { method: 'PUT', token: cToken, body: { currentPassword: 'cajero123', newPassword: 'caj12345' } });
    const cl2 = await api('/auth/login', { method: 'POST', body: { username: 'cajero', password: 'caj12345' } });
    cToken = cl2.body.token;
    const r = await api('/products/bulk', { method: 'PUT', token: cToken, body: { ids, changes: { sale_price: 1 } } });
    assert.strictEqual(r.status, 403);
  });
});
