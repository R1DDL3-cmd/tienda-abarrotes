// Tests de la capa de teclado: parser de la línea de comando, registro de
// acciones (resolución por estado/rol) y detección del lector de barras.
import test from 'node:test';
import assert from 'node:assert';

// localStorage falso: el registro lo usa para el perfil de teclas.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { parseCommand, resolveCommand, ghostSuggestion, normalize } = await import('../src/keyboard/parser.js');
const { resolveKey, actionsFor, searchActions, STATES, keysFor, setKeys, resetKeys, exportKeymap, importKeymap } = await import('../src/keyboard/registry.js');
const { createScannerDetector, SCANNER_MAX_GAP_MS } = await import('../src/keyboard/input.js');
const { eventToKeyString, keyLabel } = await import('../src/keyboard/keys.js');

test('parser de la línea de comando', async (t) => {
  await t.test('código simple', () => {
    assert.deepStrictEqual(parseCommand('7501055300201'),
      { type: 'product', code: '7501055300201', qty: 1, individual: false, amount: null });
  });

  await t.test('cantidad con * y con espacio', () => {
    const a = parseCommand('3*7501055300201');
    assert.strictEqual(a.type, 'product');
    assert.strictEqual(a.qty, 3);
    assert.strictEqual(a.code, '7501055300201');

    const b = parseCommand('3 7501055300201');
    assert.strictEqual(b.qty, 3);
    assert.strictEqual(b.code, '7501055300201');

    const c = parseCommand('2x coca');
    assert.strictEqual(c.qty, 2);
    assert.strictEqual(c.code, 'coca');
  });

  await t.test('cantidad decimal para kg/L', () => {
    const r = parseCommand('1.5*7501');
    assert.strictEqual(r.qty, 1.5);
    // también con coma decimal
    assert.strictEqual(parseCommand('1,5*7501').qty, 1.5);
  });

  await t.test('por importe con $', () => {
    const r = parseCommand('$50*jamon');
    assert.strictEqual(r.type, 'product');
    assert.strictEqual(r.amount, 50);
    assert.strictEqual(r.qty, null);
    assert.strictEqual(r.code, 'jamon');
  });

  await t.test('piezas individuales con i', () => {
    const r = parseCommand('3i*7501');
    assert.strictEqual(r.individual, true);
    assert.strictEqual(r.qty, 3);
    assert.strictEqual(r.code, '7501');
  });

  await t.test('cambiar cantidad de la línea actual', () => {
    assert.deepStrictEqual(parseCommand('*5'), { type: 'set_qty', qty: 5 });
    assert.strictEqual(parseCommand('*0').type, 'invalid');
  });

  await t.test('búsqueda, cliente y comandos', () => {
    assert.deepStrictEqual(parseCommand('?Jitómate'), { type: 'search', query: 'jitomate' });
    assert.deepStrictEqual(parseCommand('#María'), { type: 'customer', query: 'maria' });
    const cmd = parseCommand('/corte');
    assert.strictEqual(cmd.type, 'command');
    assert.strictEqual(cmd.command, 'corte');
  });

  await t.test('quitar línea, descuento y precio', () => {
    assert.deepStrictEqual(parseCommand('-7501'), { type: 'remove', code: '7501' });
    assert.deepStrictEqual(parseCommand('%10'), { type: 'discount_pct', value: 10 });
    assert.strictEqual(parseCommand('%150').type, 'invalid');
    assert.deepStrictEqual(parseCommand('=15.50'), { type: 'set_price', value: 15.5 });
    assert.strictEqual(parseCommand('=-3').type, 'invalid');
  });

  await t.test('vacío y normalización', () => {
    assert.strictEqual(parseCommand('').type, 'empty');
    assert.strictEqual(parseCommand('   ').type, 'empty');
    // normalize quita acentos y colapsa espacios (así "jitomate" encuentra "Jitómate")
    assert.strictEqual(normalize('  Á  É   '), 'a e');
  });

  await t.test('resolución de comandos por prefijo', () => {
    assert.strictEqual(resolveCommand('corte'), 'pos_close_day');
    assert.strictEqual(resolveCommand('ret'), 'pos_withdrawal');   // prefijo único
    assert.strictEqual(resolveCommand('xyz'), null);
    assert.strictEqual(ghostSuggestion('/ret'), '/retiro');
    assert.strictEqual(ghostSuggestion('7501'), null);
  });
});

test('registro de acciones', async (t) => {
  await t.test('resuelve teclas según el estado', () => {
    // F4 y F12 cobran en captura
    assert.strictEqual(resolveKey('F4', { state: STATES.CAPTURA, role: 'admin' }).id, 'pos_charge');
    assert.strictEqual(resolveKey('F12', { state: STATES.CAPTURA, role: 'admin' }).id, 'pos_charge');
    // La MISMA tecla significa otra cosa en cobro
    assert.strictEqual(resolveKey('F1', { state: STATES.CAPTURA, role: 'admin' }).id, 'pos_help');
    assert.strictEqual(resolveKey('F1', { state: STATES.COBRO, role: 'admin' }).id, 'cobro_cash');
    // Una acción de captura no existe en cobro
    assert.strictEqual(resolveKey('F8', { state: STATES.COBRO, role: 'admin' }).id, 'cobro_d200');
  });

  await t.test('respeta permisos por rol', () => {
    assert.strictEqual(resolveKey('F5', { state: STATES.CAPTURA, role: 'admin' }).id, 'pos_discount');
    assert.strictEqual(resolveKey('F5', { state: STATES.CAPTURA, role: 'cashier' }), null,
      'el cajero no puede aplicar descuentos');
    const delCajero = actionsFor({ state: STATES.CAPTURA, role: 'cashier' }).map(a => a.id);
    assert.ok(!delCajero.includes('pos_discount'));
    assert.ok(delCajero.includes('pos_charge'));
  });

  await t.test('la barra de ayuda sale del registro', () => {
    const enCaptura = actionsFor({ state: STATES.CAPTURA, role: 'admin' }).filter(a => a.helpBar);
    assert.ok(enCaptura.length >= 8, 'hay teclas suficientes para guiar al usuario nuevo');
    // Cobrar aparece primero (order más bajo)
    assert.strictEqual(enCaptura[0].id, 'pos_charge');
  });

  await t.test('la paleta encuentra por nombre parcial y sin acentos', () => {
    const r = searchActions('ret', { state: STATES.CAPTURA, role: 'admin' });
    assert.ok(r.some(a => a.id === 'pos_withdrawal'), 'encuentra "Retiro de efectivo" con 3 letras');
    const r2 = searchActions('navegacion', { state: STATES.CAPTURA, role: 'admin' });
    assert.ok(Array.isArray(r2));
    // Acciones sin tecla asignada TAMBIÉN son alcanzables por la paleta
    const sinTecla = searchActions('gasto', { state: STATES.CAPTURA, role: 'admin' });
    assert.ok(sinTecla.some(a => a.id === 'pos_expense'));
  });

  await t.test('perfil de teclas: cambiar, exportar e importar', () => {
    resetKeys();
    assert.deepStrictEqual(keysFor('pos_charge'), ['F4', 'F12']);
    setKeys('pos_charge', ['F4']);
    assert.deepStrictEqual(keysFor('pos_charge'), ['F4']);
    assert.strictEqual(resolveKey('F12', { state: STATES.CAPTURA, role: 'admin' }), null);

    const json = exportKeymap();
    resetKeys();
    assert.deepStrictEqual(keysFor('pos_charge'), ['F4', 'F12']);
    importKeymap(json);
    assert.deepStrictEqual(keysFor('pos_charge'), ['F4']);
    resetKeys();
  });
});

test('detección del lector de código de barras', async (t) => {
  await t.test('una ráfaga rápida se detecta como escaneo', () => {
    const d = createScannerDetector();
    let t0 = 1000;
    // 13 dígitos a 10 ms: velocidad típica de un lector
    let scanning = false;
    for (let i = 0; i < 13; i++) {
      scanning = d.push(t0);
      t0 += 10;
    }
    assert.strictEqual(scanning, true, 'debe reconocer la ráfaga');
  });

  await t.test('tecleo humano NO se confunde con lector', () => {
    const d = createScannerDetector();
    let t0 = 1000;
    let scanning = false;
    for (let i = 0; i < 13; i++) {
      scanning = d.push(t0);
      t0 += 120; // ~8 teclas por segundo: rápido para una persona
    }
    assert.strictEqual(scanning, false, 'el tecleo humano no debe bloquear atajos');
  });

  await t.test('el Enter cierra la lectura y se puede repetir 20 veces', () => {
    const d = createScannerDetector();
    let t0 = 0;
    for (let lectura = 0; lectura < 20; lectura++) {
      let scanning = false;
      for (let i = 0; i < 13; i++) {
        scanning = d.push(t0);
        t0 += 8;
      }
      assert.strictEqual(scanning, true, `lectura ${lectura + 1} debe detectarse`);
      d.end(); // Enter del lector
      assert.strictEqual(d.isScanning(), false);
      t0 += 800; // pausa entre productos
    }
  });

  await t.test('el umbral es el especificado', () => {
    assert.strictEqual(SCANNER_MAX_GAP_MS, 30);
  });
});

test('normalización de teclas', async (t) => {
  const ev = (key, mods = {}) => ({ key, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, metaKey: !!mods.meta });
  await t.test('cualquier tecla es asignable', () => {
    assert.strictEqual(eventToKeyString(ev('a')), 'A');
    assert.strictEqual(eventToKeyString(ev('Enter')), 'Enter');
    assert.strictEqual(eventToKeyString(ev('Delete')), 'Delete');
    assert.strictEqual(eventToKeyString(ev(' ')), 'Space');
    assert.strictEqual(eventToKeyString(ev('k', { ctrl: true })), 'Ctrl+K');
    assert.strictEqual(eventToKeyString(ev('Control', { ctrl: true })), null);
  });
  await t.test('etiquetas legibles en español', () => {
    assert.strictEqual(keyLabel('Delete'), 'Supr');
    assert.strictEqual(keyLabel('Home'), 'Inicio');
    assert.strictEqual(keyLabel('Ctrl+K'), 'Ctrl + K');
    assert.strictEqual(keyLabel('F4'), 'F4');
  });
});
