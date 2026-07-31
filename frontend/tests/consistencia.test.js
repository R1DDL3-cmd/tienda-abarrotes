// CONSISTENCIA DEL MAPA DE TECLAS (criterio de aceptación 5)
//
// La promesa del sistema es que la memoria muscular del cajero vale en todas
// las secciones: si F2 busca en el POS, F2 busca en Compras. Esta prueba lo
// verifica contra el registro, que es la única fuente de verdad.
//
// No se pueden comparar todos los estados entre sí —F1 es "Ayuda" al capturar
// y "Efectivo" al cobrar, y ambas cosas son correctas—, así que la regla real
// es por CLASE de estado: dentro de una misma clase, una tecla no puede
// significar dos cosas distintas. Las desviaciones se declaran con
// `keyException` y su motivo por escrito.
import test from 'node:test';
import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { allActions, STATES, STATE_CLASSES, stateClass, actionsFor, resolveKey, keysFor } =
  await import('../src/keyboard/registry.js');

// Clases en las que vive una acción (una acción puede valer en varios estados).
function clasesDe(action) {
  if (action.global) return ['*global*'];
  return [...new Set((action.states || []).map(stateClass))];
}

test('mapa de teclas coherente en todo el sistema', async (t) => {
  await t.test('una tecla no significa dos cosas en la misma clase de estado', () => {
    const porClaseYTecla = new Map();

    for (const action of allActions()) {
      if (action.keyException) continue;          // desviación declarada
      if (!action.semantic) continue;             // acciones sin tecla fija
      for (const clase of clasesDe(action)) {
        for (const key of action.keys) {
          const llave = `${clase}::${key}`;
          if (!porClaseYTecla.has(llave)) porClaseYTecla.set(llave, new Map());
          porClaseYTecla.get(llave).set(action.semantic, action.id);
        }
      }
    }

    const choques = [];
    for (const [llave, significados] of porClaseYTecla) {
      if (significados.size > 1) {
        choques.push(`${llave} significa ${[...significados.entries()].map(([s, id]) => `"${s}" (${id})`).join(' y ')}`);
      }
    }
    assert.deepStrictEqual(choques, [], 'teclas con dos significados en la misma clase');
  });

  await t.test('las acciones globales no chocan con NINGUNA clase', () => {
    const globales = allActions().filter(a => a.global && a.semantic);
    const conEstado = allActions().filter(a => !a.global && a.semantic && !a.keyException);
    const problemas = [];
    for (const g of globales) {
      for (const key of g.keys) {
        for (const otra of conEstado) {
          // Que una acción de estado tape a una global es legítimo (F1 en
          // cobro), pero solo si es a propósito: aquí se exige que las
          // globales de navegación y paleta NUNCA queden tapadas.
          if (otra.keys.includes(key) && (g.id === 'sys_palette' || g.semantic === 'navegar')) {
            problemas.push(`${key}: ${g.id} quedaría tapada por ${otra.id}`);
          }
        }
      }
    }
    assert.deepStrictEqual(problemas, [], 'la paleta y la navegación deben funcionar en cualquier estado');
  });

  await t.test('las excepciones están declaradas por escrito', () => {
    const excepciones = allActions().filter(a => a.keyException);
    assert.strictEqual(excepciones.length, 1, 'solo debe haber una excepción en todo el sistema');
    assert.strictEqual(excepciones[0].id, 'pos_discount');
    assert.ok(excepciones[0].keyException.length > 40, 'la excepción debe explicar el motivo');
  });

  await t.test('cada estado declara su clase', () => {
    for (const estado of Object.values(STATES)) {
      assert.ok(STATE_CLASSES[estado], `el estado ${estado} no tiene clase asignada`);
    }
  });

  await t.test('las teclas de la tabla oficial significan lo mismo en todas las secciones', () => {
    // La tabla del acuerdo: tecla → significado en los estados base de cada
    // sección (clase "captura").
    const tabla = {
      F2: 'buscar',
      F3: 'entidad',
      F4: 'principal',
      F6: 'suspender',
      F7: 'retomar',
      F8: 'historial',
      Delete: 'quitar',
      'Ctrl+Z': 'deshacer',
      ArrowUp: 'mover-arriba',
      ArrowDown: 'mover-abajo',
    };
    const enCaptura = allActions().filter(a =>
      !a.keyException && (a.states || []).some(s => stateClass(s) === 'captura'));

    for (const [key, significado] of Object.entries(tabla)) {
      const usos = enCaptura.filter(a => a.keys.includes(key));
      assert.ok(usos.length > 0, `${key} no está asignada en ningún estado de captura`);
      for (const a of usos) {
        assert.strictEqual(a.semantic, significado,
          `${key} debería significar "${significado}" y en ${a.id} significa "${a.semantic}"`);
      }
    }
  });

  await t.test('F9 es "cuentas" y ya no quita renglones', () => {
    assert.ok(!keysFor('pos_remove_line').includes('F9'), 'F9 dejó de ser alias de Supr');
    assert.ok(keysFor('pos_remove_line').includes('Delete'), 'Supr sigue quitando la línea');
    assert.strictEqual(resolveKey('F9', { state: STATES.PROVEEDOR, role: 'admin' }).id, 'compras_payable');
    assert.strictEqual(resolveKey('F9', { state: STATES.CONFIRMAR, role: 'admin' }).semantic, 'cuentas');
  });

  await t.test('F5 hace "en lote" en Compras y sigue siendo Descuento en el POS', () => {
    assert.strictEqual(resolveKey('F5', { state: STATES.PEDIDO, role: 'admin' }).id, 'compras_suggest');
    assert.strictEqual(resolveKey('F5', { state: STATES.RECEPCION, role: 'admin' }).id, 'recepcion_all_ok');
    assert.strictEqual(resolveKey('F5', { state: STATES.CAPTURA, role: 'admin' }).id, 'pos_discount');
  });
});

test('la capa de teclado sigue viva dentro de los recuadros', async (t) => {
  await t.test('la paleta y la navegación funcionan en cualquier estado', () => {
    for (const estado of Object.values(STATES)) {
      assert.strictEqual(resolveKey('F10', { state: estado, role: 'admin' })?.id, 'sys_palette',
        `F10 debe abrir la paleta también en ${estado}`);
      assert.strictEqual(resolveKey('Ctrl+3', { state: estado, role: 'admin' })?.id, 'nav_purchases',
        `Ctrl+3 debe llevar a Compras también en ${estado}`);
      assert.strictEqual(resolveKey('Alt+3', { state: estado, role: 'admin' })?.id, 'nav_purchases',
        `Alt+3 (alias para el navegador de la tablet) debe funcionar en ${estado}`);
    }
  });

  await t.test('la ayuda cede la tecla solo donde el estado la ocupa', () => {
    assert.strictEqual(resolveKey('F1', { state: STATES.PEDIDO, role: 'admin' }).id, 'sys_help');
    assert.strictEqual(resolveKey('F1', { state: STATES.COBRO, role: 'admin' }).id, 'cobro_cash');
    assert.strictEqual(resolveKey('F1', { state: STATES.ABONO, role: 'admin' }).id, 'cobro_cash');
    // Y la barra de ayuda no la ofrece dos veces
    const enCobro = actionsFor({ state: STATES.COBRO, role: 'admin' }).filter(a => a.keys.includes('F1'));
    assert.strictEqual(enCobro.length, 1, 'F1 aparece una sola vez en la ayuda de cobro');
    assert.strictEqual(enCobro[0].id, 'cobro_cash');
  });
});

test('permisos por rol en Compras', async (t) => {
  await t.test('el cajero puede pedir y recibir pero no pagar', () => {
    assert.ok(resolveKey('F4', { state: STATES.PEDIDO, role: 'cashier' }), 'puede guardar un pedido');
    assert.ok(resolveKey('F4', { state: STATES.RECEPCION, role: 'cashier' }), 'puede confirmar una recepción');
    assert.strictEqual(resolveKey('F9', { state: STATES.PROVEEDOR, role: 'cashier' }), null,
      'no puede abrir cuentas por pagar');
    assert.strictEqual(resolveKey('F4', { state: STATES.PORPAGAR, role: 'cashier' }), null,
      'no puede abonar a proveedores');
  });

  await t.test('el dueño sí', () => {
    assert.strictEqual(resolveKey('F9', { state: STATES.PROVEEDOR, role: 'admin' }).id, 'compras_payable');
    assert.strictEqual(resolveKey('F4', { state: STATES.PORPAGAR, role: 'admin' }).id, 'porpagar_pay');
  });
});

test('las seis secciones hablan el mismo idioma', async (t) => {
  // Estados base de cada sección (clase "captura").
  const SECCIONES = {
    'Punto de venta': STATES.CAPTURA,
    'Compras': STATES.PEDIDO,
    'Inventario': STATES.INVENTARIO,
    'Clientes': STATES.CLIENTES,
    'Contabilidad': STATES.CONTABILIDAD,
    'Configuración': STATES.CONFIGURACION,
    'Proyector': STATES.PROYECTOR,
  };

  await t.test('todas tienen ayuda, paleta y una acción principal', () => {
    for (const [nombre, estado] of Object.entries(SECCIONES)) {
      const acciones = actionsFor({ state: estado, role: 'admin' });
      assert.ok(acciones.some(a => a.id === 'sys_help'), `${nombre} sin ayuda (F1)`);
      assert.ok(acciones.some(a => a.id === 'sys_palette'), `${nombre} sin paleta (F10)`);
      assert.ok(acciones.some(a => a.semantic === 'principal'), `${nombre} sin acción principal (F4)`);
    }
  });

  await t.test('F4 es la acción principal en TODAS las secciones', () => {
    for (const [nombre, estado] of Object.entries(SECCIONES)) {
      const accion = resolveKey('F4', { state: estado, role: 'admin' });
      assert.ok(accion, `${nombre}: F4 no hace nada`);
      assert.strictEqual(accion.semantic, 'principal', `${nombre}: F4 debería ser la acción principal`);
    }
  });

  await t.test('F2 busca en todas las que tienen algo que buscar', () => {
    for (const [nombre, estado] of Object.entries(SECCIONES)) {
      if (estado === STATES.CONFIGURACION) continue;   // no tiene lista que filtrar
      const accion = resolveKey('F2', { state: estado, role: 'admin' });
      assert.ok(accion, `${nombre}: F2 no hace nada`);
      assert.strictEqual(accion.semantic, 'buscar', `${nombre}: F2 debería buscar`);
    }
  });

  await t.test('toda lista se navega con ↑↓', () => {
    const conLista = [STATES.CAPTURA, STATES.PEDIDO, STATES.INVENTARIO, STATES.CLIENTES,
                      STATES.PROYECTOR, STATES.PROVEEDOR, STATES.PENDIENTES, STATES.PORPAGAR, STATES.RECEPCION];
    for (const estado of conLista) {
      assert.strictEqual(resolveKey('ArrowUp', { state: estado, role: 'admin' })?.semantic, 'mover-arriba',
        `${estado}: ↑ no mueve en la lista`);
      assert.strictEqual(resolveKey('ArrowDown', { state: estado, role: 'admin' })?.semantic, 'mover-abajo',
        `${estado}: ↓ no mueve en la lista`);
    }
  });

  await t.test('Ins da de alta y Supr quita, en todas las que aplica', () => {
    for (const estado of [STATES.INVENTARIO, STATES.CLIENTES, STATES.PROVEEDOR, STATES.PEDIDO]) {
      assert.strictEqual(resolveKey('Insert', { state: estado, role: 'admin' })?.semantic, 'alta',
        `${estado}: Ins no da de alta`);
    }
    for (const estado of [STATES.CAPTURA, STATES.PEDIDO, STATES.INVENTARIO, STATES.RECEPCION]) {
      assert.strictEqual(resolveKey('Delete', { state: estado, role: 'admin' })?.semantic, 'quitar',
        `${estado}: Supr no quita`);
    }
  });

  await t.test('la barra de ayuda de cada sección guía de verdad', () => {
    for (const [nombre, estado] of Object.entries(SECCIONES)) {
      const visibles = actionsFor({ state: estado, role: 'admin' }).filter(a => a.helpBar && a.keys.length);
      assert.ok(visibles.length >= 3, `${nombre} muestra solo ${visibles.length} teclas en la barra de ayuda`);
    }
  });

  await t.test('el abono a cliente usa las mismas teclas de pago que el POS', () => {
    for (const estado of [STATES.COBRO, STATES.ABONO, STATES.ABONO_CLIENTE]) {
      assert.strictEqual(resolveKey('F1', { state: estado, role: 'admin' })?.semantic, 'pago-efectivo');
      assert.strictEqual(resolveKey('F2', { state: estado, role: 'admin' })?.semantic, 'pago-tarjeta');
      assert.strictEqual(resolveKey('F3', { state: estado, role: 'admin' })?.semantic, 'pago-transferencia');
    }
  });
});

test('toda función de Compras se alcanza en ≤3 pulsaciones desde su estado base', async (t) => {
  await t.test('las acciones principales tienen tecla directa', () => {
    const conTecla = (id) => {
      const a = allActions().find(x => x.id === id);
      assert.ok(a, `falta la acción ${id}`);
      assert.ok(a.keys.length > 0 || a.id === 'compras_link_supplier',
        `${id} debería tener una tecla directa`);
    };
    ['compras_new_order', 'compras_save_order', 'compras_suggest', 'compras_suspend',
     'compras_resume', 'compras_payable', 'compras_receive', 'recepcion_confirm',
     'recepcion_all_ok', 'recepcion_missing', 'porpagar_pay'].forEach(conTecla);
  });

  await t.test('la barra de ayuda de cada estado de Compras no está vacía', () => {
    for (const estado of [STATES.PROVEEDOR, STATES.PEDIDO, STATES.RECEPCION, STATES.CONFIRMAR, STATES.PORPAGAR]) {
      const conAyuda = actionsFor({ state: estado, role: 'admin' }).filter(a => a.helpBar && a.keys.length);
      assert.ok(conAyuda.length >= 3, `el estado ${estado} debe guiar con al menos 3 teclas visibles`);
    }
  });
});
