// Un producto comprado a VARIOS proveedores (product_suppliers).
//
// Cubre lo que de verdad puede romperse: que el vínculo múltiple no rompa el
// campo products.supplier_id del que dependen el POS, el importador y el
// filtro de Compras; que cada proveedor conserve su propio costo; y que
// recibir mercancía ligue y actualice el precio del proveedor correcto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-multiprov-test-'));
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
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
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

test('un producto con varios proveedores', async (t) => {
  await waitForServer();

  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(login.status, 200);
  const admin = login.body.token;

  const provA = (await api('/suppliers', { method: 'POST', token: admin, body: { name: 'Distribuidora Norte' } })).body.id;
  const provB = (await api('/suppliers', { method: 'POST', token: admin, body: { name: 'Distribuidora Sur' } })).body.id;

  const prod = await api('/products', {
    method: 'POST', token: admin,
    body: { name: 'Refresco 600ml', sale_price: 22, purchase_price: 16, stock: 3, min_stock: 10, supplier_id: provA },
  });
  assert.strictEqual(prod.status, 201);
  const productId = prod.body.id;

  await t.test('el proveedor que ya tenía queda migrado como habitual', async () => {
    const res = await api(`/products/${productId}/suppliers`, { token: admin });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.suppliers.length, 1);
    assert.strictEqual(res.body.suppliers[0].supplier_id, provA);
    assert.strictEqual(res.body.suppliers[0].is_preferred, 1);
  });

  await t.test('se liga un segundo proveedor con SU propio costo', async () => {
    const res = await api(`/products/${productId}/suppliers`, {
      method: 'POST', token: admin, body: { supplier_id: provB, purchase_price: 14.5, supplier_sku: 'REF-600' },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.purchase_price, 14.5);
    // El segundo NO se vuelve habitual solo por llegar después
    assert.strictEqual(res.body.is_preferred, 0);

    const dup = await api(`/products/${productId}/suppliers`, {
      method: 'POST', token: admin, body: { supplier_id: provB },
    });
    assert.strictEqual(dup.status, 400, 'no se puede ligar dos veces al mismo proveedor');
  });

  await t.test('ambos proveedores pueden pedir el producto', async () => {
    for (const prov of [provA, provB]) {
      const order = await api(`/suppliers/${prov}/suggested-order`, { token: admin });
      assert.strictEqual(order.status, 200);
      const item = order.body.items.find(i => i.product_id === productId);
      assert.ok(item, `el proveedor ${prov} debe poder surtir el producto`);
    }
  });

  await t.test('cada proveedor sugiere el pedido con SU costo', async () => {
    const a = await api(`/suppliers/${provA}/suggested-order`, { token: admin });
    const b = await api(`/suppliers/${provB}/suggested-order`, { token: admin });
    assert.strictEqual(a.body.items.find(i => i.product_id === productId).unit_price, 16);
    assert.strictEqual(b.body.items.find(i => i.product_id === productId).unit_price, 14.5);
  });

  await t.test('cambiar de habitual actualiza products.supplier_id', async () => {
    const links = (await api(`/products/${productId}/suppliers`, { token: admin })).body.suppliers;
    const linkB = links.find(l => l.supplier_id === provB);
    const upd = await api(`/products/suppliers/${linkB.id}`, { method: 'PUT', token: admin, body: { is_preferred: true } });
    assert.strictEqual(upd.status, 200);

    const prods = (await api('/products/all', { token: admin })).body.products;
    const p = prods.find(x => x.id === productId);
    assert.strictEqual(p.supplier_id, provB, 'el campo de siempre debe seguir el habitual');
    // y ambos proveedores viajan en la lista para que Compras filtre por ellos
    const ids = String(p.supplier_ids).split(',').map(Number).sort();
    assert.deepStrictEqual(ids, [provA, provB].sort());
  });

  await t.test('recibir mercancía guarda el costo del proveedor que surtió', async () => {
    const pedido = await api('/purchases', {
      method: 'POST', token: admin,
      body: {
        supplier_id: provA, status: 'pending', payment_type: 'cash',
        items: [{ product_id: productId, product_name: 'Refresco 600ml', quantity: 10, unit_price: 16 }],
      },
    });
    assert.ok(pedido.status === 200 || pedido.status === 201, 'el pedido se crea');

    const detalle = await api(`/purchases/${pedido.body.id}`, { token: admin });
    const itemId = detalle.body.items[0].id;

    const rec = await api(`/purchases/${pedido.body.id}/receive`, {
      method: 'PUT', token: admin,
      body: { items: [{ id: itemId, received_quantity: 10, received_unit_price: 17.25 }] },
    });
    assert.strictEqual(rec.status, 200);

    const links = (await api(`/products/${productId}/suppliers`, { token: admin })).body.suppliers;
    assert.strictEqual(links.find(l => l.supplier_id === provA).purchase_price, 17.25,
      'el costo nuevo se guarda en el proveedor que surtió');
    assert.strictEqual(links.find(l => l.supplier_id === provB).purchase_price, 14.5,
      'y NO contamina el costo del otro proveedor');
  });

  await t.test('recibir de un proveedor no ligado lo liga solo', async () => {
    const provC = (await api('/suppliers', { method: 'POST', token: admin, body: { name: 'Distribuidora Centro' } })).body.id;
    const pedido = await api('/purchases', {
      method: 'POST', token: admin,
      body: {
        supplier_id: provC, status: 'pending', payment_type: 'cash',
        items: [{ product_id: productId, product_name: 'Refresco 600ml', quantity: 5, unit_price: 15 }],
      },
    });
    await api(`/purchases/${pedido.body.id}/receive`, { method: 'PUT', token: admin, body: { items: [] } });

    const links = (await api(`/products/${productId}/suppliers`, { token: admin })).body.suppliers;
    assert.ok(links.some(l => l.supplier_id === provC), 'comprarle a alguien lo liga como proveedor');
  });

  await t.test('quitar el habitual pasa el relevo al más barato', async () => {
    const links = (await api(`/products/${productId}/suppliers`, { token: admin })).body.suppliers;
    const preferido = links.find(l => l.is_preferred);   // provB (14.50)
    const del = await api(`/products/suppliers/${preferido.id}`, { method: 'DELETE', token: admin });
    assert.strictEqual(del.status, 200);

    const quedan = (await api(`/products/${productId}/suppliers`, { token: admin })).body.suppliers;
    const nuevoPreferido = quedan.find(l => l.is_preferred);
    assert.ok(nuevoPreferido, 'el producto nunca se queda sin proveedor habitual');
    const masBarato = quedan.reduce((min, l) => (l.purchase_price < min.purchase_price ? l : min), quedan[0]);
    assert.strictEqual(nuevoPreferido.id, masBarato.id);

    const p = (await api('/products/all', { token: admin })).body.products.find(x => x.id === productId);
    assert.strictEqual(p.supplier_id, nuevoPreferido.supplier_id);
  });

  await t.test('el cajero no puede modificar los vínculos', async () => {
    const cajero = (await api('/auth/login', { method: 'POST', body: { username: 'cajero', password: 'cajero123' } })).body.token;
    const res = await api(`/products/${productId}/suppliers`, {
      method: 'POST', token: cajero, body: { supplier_id: provA },
    });
    assert.ok(res.status === 403 || res.status === 401, 'alta de vínculo restringida a inventario/admin');
  });
});
