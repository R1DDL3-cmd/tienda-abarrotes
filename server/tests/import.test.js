// Tests del import de Excel: categorías nuevas, celdas con varios códigos,
// filas repetidas por nombre (merge o conflicto) y stock decimal → candidato
// a venta individual. Mismo patrón que money.test.js: servidor real + BD
// temporal + fetch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-import-test-'));
const TEST_PORT = 4700 + (process.pid % 300);
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

function buildWorkbookBase64(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

test('importación de Excel', async (t) => {
  await waitForServer();

  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(login.status, 200);
  const admin = login.body.token;

  const rows = [
    // Varios códigos en una celda + stock decimal en producto por pieza
    { 'Código de Barras': '111111, 222222', 'Nombre': 'Cigarros Test', 'Categoría': 'Tabaco', 'Precio Compra': 55, 'Precio Venta': 65, 'Stock': 3.5, 'Stock Mínimo': 2, 'Proveedor': '', 'Tipo Unidad': 'Pieza', 'Activo': 'Sí' },
    // Mismo nombre, mismo precio, código distinto → se funden en un producto
    { 'Código de Barras': '333333', 'Nombre': 'Refresco Dup', 'Categoría': 'Bebidas', 'Precio Compra': 12, 'Precio Venta': 20, 'Stock': 5, 'Stock Mínimo': 1, 'Proveedor': '', 'Tipo Unidad': 'Pieza', 'Activo': 'Sí' },
    { 'Código de Barras': '444444', 'Nombre': 'Refresco Dup', 'Categoría': 'Bebidas', 'Precio Compra': 12, 'Precio Venta': 20, 'Stock': 3, 'Stock Mínimo': 1, 'Proveedor': '', 'Tipo Unidad': 'Pieza', 'Activo': 'Sí' },
    // Mismo nombre, precio DISTINTO → duda para el usuario
    { 'Código de Barras': '555555', 'Nombre': 'Galletas Dup', 'Categoría': 'Abarrotes', 'Precio Compra': 10, 'Precio Venta': 15, 'Stock': 2, 'Stock Mínimo': 1, 'Proveedor': '', 'Tipo Unidad': 'Pieza', 'Activo': 'Sí' },
    { 'Código de Barras': '666666', 'Nombre': 'Galletas Dup', 'Categoría': 'Abarrotes', 'Precio Compra': 11, 'Precio Venta': 18, 'Stock': 1, 'Stock Mínimo': 1, 'Proveedor': '', 'Tipo Unidad': 'Pieza', 'Activo': 'Sí' },
  ];

  let importRes;
  await t.test('importa y reporta merged/extraBarcodes/pending', async () => {
    importRes = await api('/products/import-excel', { method: 'POST', token: admin, body: { fileBase64: buildWorkbookBase64(rows) } });
    assert.strictEqual(importRes.status, 200);
    assert.strictEqual(importRes.body.inserted, 3, 'cigarros + refresco + galletas');
    assert.strictEqual(importRes.body.merged, 1, 'la fila duplicada de refresco se funde');
    assert.strictEqual(importRes.body.extraBarcodes, 2, '222222 (celda múltiple) y 444444 (fila fundida)');
    assert.strictEqual(importRes.body.pending.length, 2);
    assert.ok(importRes.body.pending.some(p => p.type === 'individual' && p.name === 'Cigarros Test'));
    assert.ok(importRes.body.pending.some(p => p.type === 'name_conflict' && p.name === 'Galletas Dup'));
  });

  await t.test('las categorías del archivo quedan registradas', async () => {
    const cats = await api('/products/categories', { token: admin });
    const names = cats.body.categories.map(c => c.name);
    assert.ok(names.includes('Tabaco'), 'Tabaco debe existir como categoría');
    assert.ok(names.includes('Bebidas'));
  });

  await t.test('los códigos adicionales resuelven al mismo producto', async () => {
    const viaExtra = await api('/products/barcode/222222', { token: admin });
    assert.strictEqual(viaExtra.status, 200);
    assert.strictEqual(viaExtra.body.name, 'Cigarros Test');

    const mergedProd = await api('/products/barcode/444444', { token: admin });
    assert.strictEqual(mergedProd.status, 200);
    assert.strictEqual(mergedProd.body.name, 'Refresco Dup');
    assert.strictEqual(mergedProd.body.stock, 8, 'el stock de las filas fundidas se suma (5+3)');
  });

  await t.test('resolver pendiente individual configura la venta por pieza', async () => {
    const pi = importRes.body.pending.find(p => p.type === 'individual');
    const upd = await api(`/products/${pi.product_id}`, {
      method: 'PUT', token: admin,
      body: { sellable_individually: true, units_per_package: 20, individual_price: 4 },
    });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual(upd.body.sellable_individually, 1);
    assert.strictEqual(upd.body.units_per_package, 20);
    assert.strictEqual(upd.body.stock, 3.5, 'el stock decimal se conserva');
  });

  await t.test('resolver conflicto agregando código al producto existente', async () => {
    const pc = importRes.body.pending.find(p => p.type === 'name_conflict');
    const add = await api(`/products/${pc.existing_product_id}/barcodes`, {
      method: 'POST', token: admin,
      body: { barcode: pc.barcode },
    });
    assert.strictEqual(add.status, 201);
    const via = await api(`/products/barcode/${pc.barcode}`, { token: admin });
    assert.strictEqual(via.body.name, 'Galletas Dup');
  });

  await t.test('reimportar el mismo archivo no duplica nada', async () => {
    const again = await api('/products/import-excel', { method: 'POST', token: admin, body: { fileBase64: buildWorkbookBase64(rows) } });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.inserted, 0, 'nada nuevo en la reimportación');
    // El producto con venta individual ya configurada no vuelve a preguntarse
    assert.ok(!again.body.pending.some(p => p.type === 'individual' && p.name === 'Cigarros Test'),
      'un producto ya configurado como individual no vuelve a la lista de dudas');
    // Ningún producto quedó desactivado por la reconciliación
    const all = await api('/products/all', { token: admin });
    assert.strictEqual(all.body.products.length, 3, 'los 3 productos siguen activos');
    // Las filas fundidas siguen sumando su stock también al reimportar
    // (la primera fila resetea al valor del archivo, la segunda suma)
    const refresco = await api('/products/barcode/333333', { token: admin });
    assert.strictEqual(refresco.body.stock, 8, 'stock 5+3 también en reimportación');
  });
});
