// Batería de los 8 criterios de aceptación del formato de ticket (§11).
// Son pruebas puras del renderizador: no necesitan servidor ni base de datos.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { columna, izqDer, money, aCentavos } = require('../services/ticket/columns');
const { renderLineas, renderTexto, paginar } = require('../services/ticket/renderText');
const { renderEscpos, encodeLinea } = require('../services/ticket/renderEscpos');
const { construirTicket, cargarPlantilla, validarPlantilla } = require('../services/ticket/buildTicket');
const { textoPrueba, regla } = require('../services/ticket/testPrint');

const PLANTILLA = cargarPlantilla();
const ANCHOS = [32, 48, 64];

function ticketBase(extra = {}) {
  return {
    negocio: { nombre: 'ABARROTES LA ESPERANZA', domicilio: 'AV. HIDALGO 245, COL. CENTRO', telefono: '443 123 4567' },
    folio: 'A-000124587',
    fecha_hora: '2026-07-30 14:32:11',
    caja: '03',
    cajero: 'KARINA L.',
    cliente: '',
    renglones: [
      { cant: 2, sku: '349', descripcion: 'GOMITAS RICOLINO 30 PZ', precio_regular: 8600, precio_promo: null, total: 17200, nota_promo: null },
      { cant: 1, sku: '996', descripcion: 'SURTIDO VERO MANIA 1KG', precio_regular: 5100, precio_promo: 4500, total: 4500, nota_promo: null },
      { cant: -1, sku: '349', descripcion: 'GOMITAS RICOLINO 30 PZ', precio_regular: 8600, precio_promo: null, total: -8600, nota_promo: null },
    ],
    renglones_count: 3,
    articulos: 4,
    impuestos: [],
    total: 13100,
    pagos: [{ tipo: 'EFECTIVO', referencia: '', importe: 20000 }],
    cambio: 6900,
    monedero: [],
    facturacion_url: '',
    leyenda_cierre: 'GRACIAS POR SU COMPRA',
    ...extra,
  };
}

test('formato de ticket — criterios de aceptación', async (t) => {

  await t.test('1. toda línea mide exactamente el ancho configurado', () => {
    for (const ancho of ANCHOS) {
      const lineas = renderLineas(ticketBase(), ancho, PLANTILLA);
      lineas.forEach((l, i) => {
        assert.strictEqual(l.texto.length, ancho,
          `ancho ${ancho}: renglón ${i + 1} mide ${l.texto.length} -> ${JSON.stringify(l.texto)}`);
      });
      assert.ok(lineas.length > 10, 'el ticket tiene contenido');
    }
  });

  await t.test('2. descripción de 60 caracteres no rompe la rejilla', () => {
    const larga = 'GALLETAS SURTIDAS FINAS DE CHOCOLATE CON RELLENO DE AVELLANA';
    assert.strictEqual(larga.length, 60);
    const tk = ticketBase({
      renglones: [{ cant: 1, sku: '111', descripcion: larga, precio_regular: 9900, precio_promo: null, total: 9900, nota_promo: null }],
      renglones_count: 1, articulos: 1, total: 9900,
    });
    for (const ancho of ANCHOS) {
      for (const l of renderLineas(tk, ancho, PLANTILLA)) {
        assert.strictEqual(l.texto.length, ancho, `ancho ${ancho}: ${JSON.stringify(l.texto)}`);
      }
    }
    // Y con wrapDescription tampoco se rompe
    for (const ancho of ANCHOS) {
      for (const l of renderLineas(tk, ancho, PLANTILLA, { wrapDescription: true })) {
        assert.strictEqual(l.texto.length, ancho);
      }
    }
  });

  await t.test('3. cantidad -99 y total -9999.99 caben sin desalinear', () => {
    const tk = ticketBase({
      renglones: [{ cant: -99, sku: '4321', descripcion: 'DEVOLUCION MASIVA', precio_regular: 10101, precio_promo: null, total: -999999, nota_promo: null }],
      renglones_count: 1, articulos: 99, total: -999999,
    });
    for (const ancho of ANCHOS) {
      const lineas = renderLineas(tk, ancho, PLANTILLA);
      for (const l of lineas) assert.strictEqual(l.texto.length, ancho, JSON.stringify(l.texto));
      const texto = lineas.map(l => l.texto).join('\n');
      assert.ok(texto.includes('-9999.99'), `ancho ${ancho}: debe verse el total negativo completo`);
      assert.ok(texto.includes('-99'), `ancho ${ancho}: debe verse la cantidad negativa`);
    }
  });

  await t.test('4. un total de 123456.78 cabe en su campo', () => {
    const tk = ticketBase({
      renglones: [{ cant: 1, sku: '1', descripcion: 'LOTE MAYOREO', precio_regular: 12345678, precio_promo: null, total: 12345678, nota_promo: null }],
      renglones_count: 1, articulos: 1, total: 12345678, pagos: [{ tipo: 'TRANSFERENCIA', referencia: '', importe: 12345678 }], cambio: 0,
    });
    for (const ancho of ANCHOS) {
      const lineas = renderLineas(tk, ancho, PLANTILLA);
      for (const l of lineas) assert.strictEqual(l.texto.length, ancho);
      const texto = lineas.map(l => l.texto).join('\n');
      assert.ok(texto.includes('123456.78'), `ancho ${ancho}: el TOTAL no debe truncarse`);
    }
  });

  await t.test('5. ticket de 60 renglones pagina sin cortar un renglón', () => {
    const muchos = Array.from({ length: 60 }, (_, i) => ({
      cant: 1, sku: String(1000 + i), descripcion: `PRODUCTO NUMERO ${i + 1}`,
      precio_regular: 1000 + i, precio_promo: null, total: 1000 + i, nota_promo: null,
    }));
    const total = muchos.reduce((s, r) => s + r.total, 0);
    const tk = ticketBase({ renglones: muchos, renglones_count: 60, articulos: 60, total, pagos: [{ tipo: 'EFECTIVO', referencia: '', importe: total }], cambio: 0 });

    for (const ancho of ANCHOS) {
      const lineas = renderLineas(tk, ancho, PLANTILLA);
      for (const l of lineas) assert.strictEqual(l.texto.length, ancho);
      const paginas = paginar(lineas, 40);
      // Ningún renglón se pierde ni se parte entre páginas
      const reconstruido = paginas.flat();
      assert.strictEqual(reconstruido.length, lineas.length);
      assert.deepStrictEqual(reconstruido.map(l => l.texto), lineas.map(l => l.texto));
      assert.ok(paginas.length > 1, 'debe haber más de una página');
      for (const p of paginas.slice(0, -1)) assert.strictEqual(p.length, 40);
    }
  });

  await t.test('6. el ticket en 48 y en 64 columnas contiene la misma información', () => {
    const tk = ticketBase();
    const extraer = (ancho) => {
      const texto = renderTexto(tk, ancho, PLANTILLA);
      return {
        folio: /FOLIO:\s*(\S+)/.exec(texto)?.[1],
        total: /TOTAL \$\s+([\-\d.]+)/.exec(texto)?.[1],
        articulos: /ARTICULOS:\s*(\d+)/.exec(texto)?.[1],
        renglones: /RENGLONES:\s*(\d+)/.exec(texto)?.[1],
        cambio: /SU CAMBIO\s+([\-\d.]+)/.exec(texto)?.[1],
      };
    };
    assert.deepStrictEqual(extraer(48), extraer(64));
    assert.deepStrictEqual(extraer(48), extraer(32));
    // Los SKU completos solo caben en 64: es la diferencia esperada
    assert.ok(renderTexto(tk, 64, PLANTILLA).includes('PROMOCION'));
    assert.ok(renderTexto(tk, 48, PLANTILLA).includes('PROMO'));
  });

  await t.test('7. la suma de renglones cuadra con el TOTAL al centavo (enteros)', () => {
    // Precios que en punto flotante darían 0.30000000000000004
    const sale = {
      id: 124587, created_at: '2026-07-30 20:32:11', discount: 0,
      created_by_name: 'KARINA L.', customer_name: '',
      payment_details: JSON.stringify([{ method: 'cash', amount: 1 }]),
      items: [
        { quantity: 3, unit_price: 0.1, discount: 0, product_name: 'A', barcode: '1' },
        { quantity: 7, unit_price: 0.07, discount: 0, product_name: 'B', barcode: '2' },
        { quantity: 1, unit_price: 19.99, discount: 0, product_name: 'C', barcode: '3' },
      ],
    };
    const tk = construirTicket(sale, { store_name: 'X' }, PLANTILLA);
    const suma = tk.renglones.reduce((s, r) => s + r.total, 0);
    assert.strictEqual(Number.isInteger(suma), true, 'los importes deben ser enteros (centavos)');
    assert.strictEqual(tk.total, suma, 'el TOTAL debe ser exactamente la suma de renglones');
    assert.strictEqual(tk.total, 30 + 49 + 1999);
    // Y con descuento global
    const tk2 = construirTicket({ ...sale, discount: 1.5 }, { store_name: 'X' }, PLANTILLA);
    assert.strictEqual(tk2.total, suma - 150);
  });

  await t.test('8. la vista previa es idéntica carácter por carácter a lo impreso', () => {
    const tk = ticketBase();
    const ancho = 32;
    const texto = renderTexto(tk, ancho, PLANTILLA);
    const lineas = renderLineas(tk, ancho, PLANTILLA);
    // La previa se arma de los MISMOS renglones que alimentan al ESC/POS
    assert.strictEqual(texto, lineas.map(l => l.texto).join('\n'));
    // Y esos renglones son los que se codifican a bytes
    const bytes = renderEscpos(tk, ancho, PLANTILLA);
    const impreso = bytes.toString('latin1');
    for (const l of lineas) {
      const t = l.texto.trim();
      if (t && !/^[-+|]+$/.test(t)) {
        assert.ok(impreso.includes(t) || impreso.includes(l.texto),
          `el renglón debe estar en los bytes: ${JSON.stringify(t)}`);
      }
    }
  });
});

test('reglas de formato de datos (§4)', async (t) => {
  await t.test('importes: 2 decimales, sin separador de miles, negativo pegado', () => {
    assert.strictEqual(money(0), '0.00');
    assert.strictEqual(money(5), '0.05');
    assert.strictEqual(money(-4300), '-43.00');
    assert.strictEqual(money(12345678), '123456.78');
    assert.ok(!money(12345678).includes(','), 'sin separador de miles');
  });

  await t.test('precio de promoción vacío cuando no hay promoción', () => {
    const texto = renderTexto(ticketBase(), 48, PLANTILLA);
    const renglon = texto.split('\n').find(l => l.includes('GOMITAS RICOL') && l.includes('172.00'));
    // La columna de promoción debe quedar en blanco, no "0.00" ni guiones
    assert.ok(!renglon.includes('0.00   '), 'no debe imprimir 0.00 en promoción');
    assert.ok(!renglon.includes('---'), 'no debe imprimir guiones');
  });

  await t.test('la descripción se trunca, no se envuelve (por defecto)', () => {
    const tk = ticketBase({
      renglones: [{ cant: 1, sku: '1', descripcion: 'DESCRIPCION EXTREMADAMENTE LARGA QUE NO CABE', precio_regular: 100, precio_promo: null, total: 100, nota_promo: null }],
      renglones_count: 1, articulos: 1, total: 100,
    });
    const sinWrap = renderLineas(tk, 48, PLANTILLA).length;
    const conWrap = renderLineas(tk, 48, PLANTILLA, { wrapDescription: true }).length;
    assert.ok(conWrap > sinWrap, 'wrapDescription debe agregar renglones');
  });

  await t.test('la nota de promoción va pegada al grupo, alineada a la derecha', () => {
    const tk = ticketBase();
    tk.renglones[1].nota_promo = 'Compra 2/Gratis 1/2 @ -87.50';
    const lineas = renderTexto(tk, 48, PLANTILLA).split('\n');
    const idx = lineas.findIndex(l => l.includes('Compra 2/Gratis'));
    assert.ok(idx > 0);
    assert.ok(lineas[idx - 1].includes('SURTIDO VERO'), 'debe ir justo debajo del artículo');
    assert.ok(lineas[idx].endsWith('-87.50'), 'alineada a la derecha');
  });

  await t.test('nunca se imprime el número completo de la tarjeta', () => {
    const sale = {
      id: 1, created_at: '2026-07-30 20:00:00', discount: 0, created_by_name: 'X', customer_name: '',
      payment_details: JSON.stringify([{ method: 'card', amount: 100, marca: 'VISA', ultimos4: '4825', autorizacion: '437669' }]),
      items: [{ quantity: 1, unit_price: 100, discount: 0, product_name: 'A', barcode: '1' }],
    };
    const tk = construirTicket(sale, { store_name: 'X' }, PLANTILLA);
    const texto = renderTexto(tk, 48, PLANTILLA);
    assert.ok(texto.includes('4825'), 'muestra los últimos 4');
    assert.ok(texto.includes('AUTO 437669'), 'muestra la autorización');
    assert.strictEqual(tk.pagos[0].referencia.includes('VISA 4825'), true);
  });

  await t.test('el cambio se imprime siempre, aunque sea 0.00', () => {
    const tk = ticketBase({ cambio: 0, pagos: [{ tipo: 'TARJETA', referencia: '', importe: 13100 }] });
    const texto = renderTexto(tk, 32, PLANTILLA);
    assert.ok(/SU CAMBIO\s+0\.00/.test(texto));
  });

  await t.test('la leyenda de autorización solo sale si hubo tarjeta', () => {
    const conTarjeta = renderTexto(ticketBase({ pagos: [{ tipo: 'TARJETA', referencia: '', importe: 13100 }] }), 32, PLANTILLA);
    const sinTarjeta = renderTexto(ticketBase(), 32, PLANTILLA);
    assert.ok(conTarjeta.includes('AUTORIZADO CON FIRMA'));
    assert.ok(!sinTarjeta.includes('AUTORIZADO CON FIRMA'));
  });

  await t.test('la reimpresión se marca como COPIA', () => {
    const original = renderTexto(ticketBase(), 32, PLANTILLA);
    const copia = renderTexto(ticketBase(), 32, PLANTILLA, { copia: true });
    assert.ok(!original.includes('COPIA'));
    assert.ok(copia.includes('*** COPIA ***'));
    for (const l of copia.split('\n')) assert.strictEqual(l.length, 32);
  });
});

test('plantilla y utilidades', async (t) => {
  await t.test('la plantilla es válida: cada rejilla suma su ancho', () => {
    assert.strictEqual(validarPlantilla(PLANTILLA), true);
    for (const ancho of ANCHOS) {
      const campos = PLANTILLA.rejillas[String(ancho)].campos;
      const suma = Object.entries(campos).filter(([k]) => !k.startsWith('_')).reduce((s, [, v]) => s + v, 0);
      assert.strictEqual(suma, ancho, `la rejilla de ${ancho} debe sumar ${ancho}`);
    }
  });

  await t.test('una plantilla mal configurada falla al validarse', () => {
    assert.throws(() => validarPlantilla({ rejillas: { 32: { campos: { a: 10, b: 10 } } } }), /inválida/);
  });

  await t.test('columna() respeta ancho, alineación y truncado', () => {
    assert.strictEqual(columna('abc', 5, 'left'), 'abc  ');
    assert.strictEqual(columna('abc', 5, 'right'), '  abc');
    assert.strictEqual(columna('abcdefgh', 5), 'abcde');
    assert.strictEqual(columna('ab', 6, 'center'), '  ab  ');
    assert.strictEqual(columna(null, 3), '   ');
  });

  await t.test('izqDer() nunca pega la etiqueta al importe', () => {
    const r = izqDer('DULCERIA DEPTO ABARROTES LARGO', '12.00', 28);
    assert.strictEqual(r.length, 28);
    assert.ok(/\s{2}12\.00$/.test(r), `debe haber separación: ${JSON.stringify(r)}`);
  });

  await t.test('aCentavos convierte sin errores de flotante', () => {
    assert.strictEqual(aCentavos(19.99), 1999);
    assert.strictEqual(aCentavos(0.1), 10);
    assert.strictEqual(aCentavos(86), 8600);
  });

  await t.test('la prueba de impresión trae reglas de 32, 48 y 64', () => {
    const texto = textoPrueba(PLANTILLA);
    assert.ok(texto.includes('[32]'));
    assert.ok(texto.includes('[48]'));
    assert.ok(texto.includes('[64]'));
    assert.strictEqual(regla(32).length, 32);
    assert.strictEqual(regla(48).length, 48);
  });

  await t.test('ESC/POS: comandos de inicio y corte presentes', () => {
    const bytes = renderEscpos(ticketBase(), 32, PLANTILLA);
    assert.strictEqual(bytes[0], 0x1B);
    assert.strictEqual(bytes[1], 0x40, 'debe iniciar con ESC @');
    const hex = bytes.toString('hex');
    assert.ok(hex.includes('1d5601'), 'debe terminar con corte parcial GS V 1');
    assert.ok(hex.includes('1b7402'), 'debe fijar la página de códigos');
  });

  await t.test('ESC/POS: el cajón solo se abre si hubo efectivo', () => {
    const conEfectivo = renderEscpos(ticketBase(), 32, PLANTILLA).toString('hex');
    const soloTarjeta = renderEscpos(ticketBase({ pagos: [{ tipo: 'TARJETA', referencia: '', importe: 13100 }] }), 32, PLANTILLA).toString('hex');
    assert.ok(conEfectivo.includes('1b700019fa'), 'con efectivo debe abrir el cajón');
    assert.ok(!soloTarjeta.includes('1b700019fa'), 'con tarjeta NO debe abrirlo');
  });

  await t.test('acentos: CP850 por defecto, transliteración como respaldo', () => {
    assert.deepStrictEqual(Array.from(encodeLinea('ñ')), [0xA4]);
    assert.deepStrictEqual(Array.from(encodeLinea('á')), [0xA0]);
    assert.deepStrictEqual(Array.from(encodeLinea('ñ', { translit: true })), ['n'.charCodeAt(0)]);
    assert.deepStrictEqual(Array.from(encodeLinea('á', { translit: true })), ['a'.charCodeAt(0)]);
    // Un carácter desconocido nunca debe emitir un byte de comando
    for (const b of encodeLinea('日')) assert.ok(b >= 0x20, 'sin bytes de control');
  });
});
