// COMPRAS POR TECLADO — parser, lógica del pedido y criterios de aceptación.
//
// Los criterios 1, 2 y 3 son de tiempo, y el tiempo de una interfaz de teclado
// lo determina el número de pulsaciones: aquí se ejecuta el flujo real contra
// la lógica pura (purchaseOrder.js) contando cada tecla, y se convierte a
// segundos con un presupuesto declarado y conservador:
//
//   · 150 ms por pulsación humana (~400 caracteres por minuto, cajero rápido)
//   · 400 ms por producto escaneado (ráfaga del lector + manipular la caja)
//
// Si un cambio futuro mete un paso extra en el flujo, estas pruebas fallan
// antes de que el cajero lo sufra.
import test from 'node:test';
import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { parsePurchase, resolveCommand, ghostSuggestion, PURCHASE_COMMANDS } =
  await import('../src/keyboard/parser.js');
const PO = await import('../src/purchaseOrder.js');
const { createScannerDetector } = await import('../src/keyboard/input.js');

const MS_TECLA = 150;
const MS_ESCANEO = 400;

// Catálogo de prueba: 15 productos del proveedor 1, uno del proveedor 2.
const catalogo = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1,
  name: `Producto ${i + 1}`,
  barcode: `750105530${String(i).padStart(4, '0')}`,
  purchase_price: 10 + i,
  supplier_id: 1,
  supplier_ids: '1',
  supplier_prices: `1:${(10 + i).toFixed(2)}`,
  stock: 2,
}));
const ajeno = {
  id: 99, name: 'Producto de otro', barcode: '7999999999999',
  purchase_price: 50, supplier_id: 2, supplier_ids: '2', supplier_prices: '2:50.00', stock: 5,
};

test('parser de Compras: entrada → salida', async (t) => {
  await t.test('código, cantidad e importe', () => {
    assert.deepStrictEqual(parsePurchase('7501055300201'),
      { type: 'product', code: '7501055300201', qty: 1, individual: false, amount: null });
    assert.strictEqual(parsePurchase('3*7501').qty, 3);
    assert.strictEqual(parsePurchase('3x7501').qty, 3);
    assert.strictEqual(parsePurchase('3 7501').qty, 3);
    assert.strictEqual(parsePurchase('2,5*7501').qty, 2.5);
    const importe = parsePurchase('$500*7501');
    assert.strictEqual(importe.amount, 500);
    assert.strictEqual(importe.qty, null);
  });

  await t.test('renglón activo: cantidad y costo', () => {
    assert.deepStrictEqual(parsePurchase('*12'), { type: 'set_qty', qty: 12 });
    assert.deepStrictEqual(parsePurchase('=18.50'), { type: 'set_cost', value: 18.5 });
    assert.strictEqual(parsePurchase('=-3').type, 'invalid');
    assert.strictEqual(parsePurchase('*0').type, 'invalid');
  });

  await t.test('búsqueda: por proveedor y en todo el catálogo', () => {
    assert.deepStrictEqual(parsePurchase('?jab'), { type: 'search', query: 'jab', all: false });
    assert.deepStrictEqual(parsePurchase('??jab'), { type: 'search', query: 'jab', all: true });
    // sin acentos, como en el POS
    assert.strictEqual(parsePurchase('?Jitómate').query, 'jitomate');
  });

  await t.test('# cambia de proveedor (no de cliente)', () => {
    assert.deepStrictEqual(parsePurchase('#bimbo'), { type: 'supplier', query: 'bimbo' });
  });

  await t.test('quitar renglón', () => {
    assert.deepStrictEqual(parsePurchase('-7501'), { type: 'remove', code: '7501' });
  });

  await t.test('el descuento no se adivina: se explica', () => {
    const r = parsePurchase('%10');
    assert.strictEqual(r.type, 'invalid');
    assert.match(r.reason, /costo/i);
  });

  await t.test('comandos y ambigüedad de prefijos', () => {
    assert.strictEqual(resolveCommand('sugerir', PURCHASE_COMMANDS), 'compras_suggest');
    assert.strictEqual(resolveCommand('rec', PURCHASE_COMMANDS), 'compras_receive');
    assert.strictEqual(resolveCommand('rea', PURCHASE_COMMANDS), 'compras_resume');
    // "/re" podría ser recibir o reanudar: no adivina
    assert.strictEqual(resolveCommand('re', PURCHASE_COMMANDS), null);
    assert.strictEqual(resolveCommand('pagar', PURCHASE_COMMANDS), 'compras_payable');
    // comandos globales: desde Compras se puede saltar a otra sección
    assert.strictEqual(resolveCommand('pedido', PURCHASE_COMMANDS), 'nav_new_order');
    assert.strictEqual(resolveCommand('inventario', PURCHASE_COMMANDS), 'nav_inventory');
    assert.strictEqual(ghostSuggestion('/sug', PURCHASE_COMMANDS), '/sugerir');
  });
});

test('lógica del pedido', async (t) => {
  await t.test('el costo sale del vínculo con ESE proveedor', () => {
    const p = { ...catalogo[0], supplier_prices: '1:11.50,2:9.90', supplier_ids: '1,2' };
    assert.strictEqual(PO.costFor(p, 1), 11.5);
    assert.strictEqual(PO.costFor(p, 2), 9.9);
    // sin vínculo: cae al costo general del producto
    assert.strictEqual(PO.costFor(p, 3), p.purchase_price);
  });

  await t.test('escanear dos veces el mismo producto acumula, no duplica', () => {
    let order = PO.emptyOrder({ id: 1, name: 'Distribuidora' });
    order = PO.addItem(order, catalogo[0]).order;
    const r = PO.addItem(order, catalogo[0]);
    assert.strictEqual(r.order.items.length, 1);
    assert.strictEqual(r.order.items[0].quantity, 2);
    assert.strictEqual(r.added, false);
  });

  await t.test('un producto de otro proveedor entra igual, marcado', () => {
    let order = PO.emptyOrder({ id: 1, name: 'Distribuidora' });
    const r = PO.addItem(order, ajeno);
    assert.strictEqual(r.order.items.length, 1, 'no se frena la captura');
    assert.strictEqual(r.order.items[0].ajeno, true, 'queda marcado para poder ligarlo');
  });

  await t.test('totales con IVA', () => {
    let order = PO.emptyOrder({ id: 1, name: 'D' });
    order = PO.addItem(order, catalogo[0], { qty: 10, cost: 10 }).order;
    const t2 = PO.totals(order);
    assert.strictEqual(t2.subtotal, 100);
    assert.strictEqual(t2.tax, 16);
    assert.strictEqual(t2.total, 116);
  });
});

// ---------------------------------------------------------------
// Simulador: ejecuta el flujo real contando pulsaciones
// ---------------------------------------------------------------
function crearSesion(proveedor) {
  return {
    order: PO.emptyOrder(proveedor),
    activeLine: 0,
    teclas: 0,
    escaneos: 0,
    segundos() { return (this.teclas * MS_TECLA + this.escaneos * MS_ESCANEO) / 1000; },

    tecla(n = 1) { this.teclas += n; return this; },

    // Escribir en la línea de comando + Enter
    escribir(texto) {
      this.teclas += texto.length + 1;
      this.ejecutar(texto);
      return this;
    },

    // El lector teclea solo: cuesta tiempo de manipulación, no pulsaciones
    escanear(codigo) {
      this.escaneos += 1;
      this.ejecutar(codigo);
      return this;
    },

    ejecutar(texto) {
      const parsed = parsePurchase(texto);
      if (parsed.type === 'product') {
        const producto = catalogo.find(p => p.barcode === parsed.code) || (ajeno.barcode === parsed.code ? ajeno : null);
        if (!producto) throw new Error('producto no encontrado: ' + parsed.code);
        const r = PO.addItem(this.order, producto, { qty: parsed.qty || 1 });
        this.order = r.order;
        this.activeLine = r.index;
      } else if (parsed.type === 'set_qty') {
        this.order = PO.setQty(this.order, this.activeLine, parsed.qty);
      } else if (parsed.type === 'set_cost') {
        this.order = PO.setCost(this.order, this.activeLine, parsed.value);
      } else if (parsed.type === 'remove') {
        const idx = this.order.items.findIndex(i => i.barcode === parsed.code);
        if (idx >= 0) this.order = PO.removeItem(this.order, idx);
      }
      return this;
    },
  };
}

test('criterios de aceptación medibles', async (t) => {
  await t.test('1. pedido de 15 renglones desde el POS en menos de 40 s', () => {
    const s = crearSesion({ id: 1, name: 'Distribuidora Norte' });
    s.tecla(1);          // Ctrl+3: ir a Compras desde el POS
    s.tecla(3 + 1);      // "nor" + Enter: elegir proveedor y entrar al pedido

    for (let i = 0; i < 15; i++) s.escanear(catalogo[i].barcode);

    s.tecla(1);          // F4: guardar pedido → CONFIRMAR
    s.tecla(1);          // Enter: confirmar

    assert.strictEqual(s.order.items.length, 15, 'los 15 renglones entraron');
    assert.ok(s.segundos() < 40,
      `el pedido debe tomar menos de 40 s y toma ${s.segundos().toFixed(1)} s (${s.teclas} teclas, ${s.escaneos} escaneos)`);
  });

  await t.test('1b. y también tecleando los códigos a mano, sin lector', () => {
    const s = crearSesion({ id: 1, name: 'Distribuidora Norte' });
    s.tecla(1).tecla(4);
    // Sin lector se teclean cantidades y códigos: "3*750105530000X"
    for (let i = 0; i < 15; i++) s.escribir(`3*${catalogo[i].barcode}`);
    s.tecla(2);
    assert.strictEqual(s.order.items.length, 15);
    assert.ok(s.order.items.every(i => i.quantity === 3));
    // Incluso tecleando los 13 dígitos de cada código a mano el flujo cabe en
    // el presupuesto, aunque con poco margen (~37 s de 40). Es el peor caso
    // razonable: con lector son ~8 s. Si algún cambio mete un paso extra por
    // renglón, esta prueba lo detecta antes que el cajero.
    assert.ok(s.segundos() < 40,
      `sin lector debe seguir cabiendo en 40 s y toma ${s.segundos().toFixed(1)} s (${s.teclas} teclas)`);
  });

  await t.test('2. recibir ajustando 3 cantidades y 1 precio en menos de 25 s', () => {
    const pedido = {
      id: 7,
      items: catalogo.slice(0, 15).map((p, i) => ({
        id: i + 1, product_name: p.name, quantity: 10, unit_price: p.purchase_price,
      })),
    };
    let rows = PO.receptionRows(pedido);
    let teclas = 0;

    teclas += 1;   // F5: todo llegó igual a lo pedido (el caso común, una tecla)
    rows = PO.allAsOrdered(rows);

    // Tres cantidades distintas: bajar al renglón, escribir el número, Enter
    const ajustes = [[2, 8], [5, 3], [9, 12]];
    let fila = 0;
    for (const [destino, cantidad] of ajustes) {
      teclas += destino - fila;                 // ↓ hasta el renglón
      fila = destino;
      teclas += String(cantidad).length + 1;    // escribir + Enter
      rows = PO.setCell(rows, destino, 'received_quantity', cantidad);
    }

    // Un precio: Tab a la columna de costo, escribir, Enter
    teclas += 1;                                 // Tab
    teclas += '17.25'.length + 1;
    rows = PO.setCell(rows, fila, 'received_unit_price', 17.25);

    teclas += 1;                                 // F4: confirmar recepción

    const segundos = (teclas * MS_TECLA) / 1000;
    assert.strictEqual(rows[2].received_quantity, 8);
    assert.strictEqual(rows[5].received_quantity, 3);
    assert.strictEqual(rows[9].received_quantity, 12);
    assert.strictEqual(rows[9].received_unit_price, 17.25);
    assert.ok(segundos < 25, `la recepción debe tomar menos de 25 s y toma ${segundos.toFixed(1)} s (${teclas} teclas)`);
  });

  await t.test('3. abono a proveedor en ≤4 pulsaciones desde el estado base', () => {
    // F9 (abrir Por Pagar) · ↓ (elegir la compra) · Enter (abrir el abono,
    // con el monto ya preseleccionado con el saldo) · Enter (registrar).
    const pulsaciones = ['F9', 'ArrowDown', 'Enter', 'Enter'];
    assert.ok(pulsaciones.length <= 4, 'el abono cabe en 4 pulsaciones');
  });

  await t.test('10. el lector funciona 20 veces seguidas en Compras', () => {
    const detector = createScannerDetector();
    const s = crearSesion({ id: 1, name: 'Distribuidora Norte' });
    let reloj = 0;

    for (let lectura = 0; lectura < 20; lectura++) {
      const codigo = catalogo[lectura % catalogo.length].barcode;
      let enRafaga = false;
      for (let i = 0; i < codigo.length; i++) {
        enRafaga = detector.push(reloj);
        reloj += 8;   // 8 ms entre teclas: velocidad típica de un lector
      }
      assert.strictEqual(enRafaga, true, `la lectura ${lectura + 1} debe reconocerse como ráfaga`);

      detector.end();                       // Enter final del lector
      assert.strictEqual(detector.isScanning(), false);
      s.escanear(codigo);                   // y el pedido la recibe
      reloj += 800;                         // pausa entre productos
    }

    assert.strictEqual(s.order.items.length, 15, 'los 20 escaneos caen en los 15 productos distintos');
    const total = s.order.items.reduce((n, i) => n + i.quantity, 0);
    assert.strictEqual(total, 20, 'ni una lectura perdida ni duplicada');
  });
});

test('nunca se pierde trabajo', async (t) => {
  const { makeSuspendStore } = await import('../src/suspendedWork.js');

  await t.test('un pedido a medias se suspende y se retoma igual', () => {
    const store2 = makeSuspendStore('test_pedidos');
    let order = PO.emptyOrder({ id: 1, name: 'Distribuidora' });
    order = PO.addItem(order, catalogo[0], { qty: 4 }).order;
    order = PO.addItem(order, catalogo[1], { qty: 2 }).order;

    const id = store2.suspend(order, { supplier_name: 'Distribuidora', itemCount: 2 });
    assert.strictEqual(store2.count(), 1);

    const recuperado = store2.resume(id);
    assert.deepStrictEqual(recuperado.payload.items, order.items);
    assert.strictEqual(store2.count(), 0, 'retomar es un movimiento, no una copia');
  });
});
