// Renderizador de TEXTO del ticket. Es la fuente única del layout: el
// renderizador ESC/POS (renderEscpos.js) consume estos mismos renglones y solo
// les agrega los comandos de la impresora. Nunca se duplica el layout.
//
// Devuelve un arreglo de renglones, cada uno de EXACTAMENTE `ancho`
// caracteres. Esa invariante la verifica la batería de pruebas renglón por
// renglón (criterio de aceptación 1).
const { columna, centrar, izqDer, envolver, marco, money } = require('./columns');

const MARCOS = {
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
  cp850: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
};

// Marca cada renglón con el estilo que la impresora debe aplicarle. El
// renderizador de texto ignora los estilos; el de ESC/POS los traduce a
// comandos. Así ambos parten de la MISMA lista.
function linea(texto, estilo) {
  return estilo ? { texto, ...estilo } : { texto };
}

function renderLineas(ticket, ancho, plantilla, opciones = {}) {
  const rejilla = plantilla.rejillas[String(ancho)];
  if (!rejilla) throw new Error(`No hay rejilla definida para ${ancho} columnas`);
  const B = plantilla.bloques || {};
  const L = [];
  const add = (texto, estilo) => L.push(linea(texto, estilo));
  const blanco = () => add(' '.repeat(ancho));
  const separador = () => add('-'.repeat(ancho));

  // ---- 1-3 Encabezado del negocio ----
  if (ticket.negocio?.logo && B.logo) add(centrar('', ancho), { logo: true });
  add(centrar(ticket.negocio?.nombre || '', ancho), { doble: true, enfasis: true });
  if (B.sucursal && ticket.negocio?.sucursal) add(centrar(ticket.negocio.sucursal, ancho));
  for (const l of envolver(ticket.negocio?.domicilio || '', ancho)) {
    if (l) add(centrar(l, ancho));
  }
  if (ticket.negocio?.telefono) add(centrar('Tel: ' + ticket.negocio.telefono, ancho));

  // ---- 5 Bloque legal (desactivado por defecto: la tienda no factura) ----
  if (B.fiscal && ticket.fiscal) {
    blanco();
    for (const campo of ['razon_social', 'domicilio']) {
      for (const l of envolver(ticket.fiscal[campo] || '', ancho)) if (l) add(centrar(l, ancho), { fontB: true });
    }
    if (ticket.fiscal.rfc) add(centrar('RFC: ' + ticket.fiscal.rfc, ancho), { fontB: true });
    for (const l of envolver(ticket.fiscal.regimen || '', ancho)) if (l) add(centrar(l, ancho), { fontB: true });
  }
  blanco();

  // Reimpresión: se marca SIEMPRE, para que una copia no pueda pasar por
  // original en una devolución.
  if (opciones.copia) {
    add(centrar(plantilla.leyendas?.copia || '*** COPIA ***', ancho), { enfasis: true });
    blanco();
  }
  if (opciones.sinConexion) {
    add(centrar(plantilla.leyendas?.sin_conexion || '', ancho), { enfasis: true });
    blanco();
  }

  // ---- 7 Identificación: sin esto no se puede atender una devolución ----
  if (B.identificacion !== false) {
    if (ancho >= 48) {
      add(izqDer('FOLIO: ' + ticket.folio, ticket.fecha_hora, ancho));
      add(columna(`CAJA: ${ticket.caja}   CAJERO: ${ticket.cajero}`, ancho));
    } else {
      add(columna('FOLIO: ' + ticket.folio, ancho));
      add(columna(ticket.fecha_hora, ancho));
      add(columna(`CAJA: ${ticket.caja}  ${ticket.cajero}`, ancho));
    }
    if (ticket.cliente) add(columna('CLIENTE: ' + ticket.cliente, ancho));
  }
  separador();

  // ---- 8-10 Artículos ----
  const C = rejilla.campos;
  if (rejilla.modo === 'una_linea') {
    const pre = C.cant + C.sp1 + C.sku + C.sp2 + C.desc;
    add(' '.repeat(pre) + columna('PRECIO', C.regular, 'right') +
        columna('PRECIO', C.promo, 'right') + ' '.repeat(C.total));
    add(columna('CANT', C.cant, 'right') + ' '.repeat(C.sp1) +
        columna('SKU', C.sku, 'right') + ' '.repeat(C.sp2) +
        columna('ARTICULO', C.desc, 'left') +
        columna('REGULAR', C.regular, 'right') +
        columna(rejilla.encabezado_promo || 'PROMO', C.promo, 'right') +
        columna('TOTAL', C.total, 'right'));
    for (const r of ticket.renglones) {
      add(columna(r.cant, C.cant, 'right') + ' '.repeat(C.sp1) +
          columna(String(r.sku ?? '').slice(-C.sku), C.sku, 'right') + ' '.repeat(C.sp2) +
          columna(r.descripcion, C.desc, 'left') +
          columna(money(r.precio_regular), C.regular, 'right') +
          // Vacío —no "0.00" ni guiones— cuando se vendió a precio regular.
          columna(r.precio_promo != null ? money(r.precio_promo) : '', C.promo, 'right') +
          columna(money(r.total), C.total, 'right'));
      if (opciones.wrapDescription && String(r.descripcion).length > C.desc) {
        const resto = String(r.descripcion).slice(C.desc);
        for (const parte of envolver(resto, C.desc)) {
          add(' '.repeat(C.cant + C.sp1 + C.sku + C.sp2) + columna(parte, ancho - (C.cant + C.sp1 + C.sku + C.sp2), 'left'));
        }
      }
      if (r.nota_promo) add(columna(r.nota_promo, ancho, 'right'));
    }
  } else {
    // Dos renglones por artículo: descripción completa arriba, números abajo.
    for (const r of ticket.renglones) {
      for (const parte of (opciones.wrapDescription ? envolver(r.descripcion, ancho) : [String(r.descripcion).slice(0, ancho)])) {
        add(columna(parte, ancho, 'left'));
      }
      const precio = r.precio_promo != null ? r.precio_promo : r.precio_regular;
      add(columna(r.cant, C.cant, 'right') + ' x ' +
          columna(money(precio), C.precio, 'left') +
          columna(money(r.total), C.total, 'right'));
      if (r.nota_promo) add(columna(r.nota_promo, ancho, 'right'));
    }
  }

  // ---- 11-12 Impuestos ----
  separador();
  if (B.impuestos && ticket.impuestos?.length) {
    for (const imp of ticket.impuestos) add(izqDer(imp.etiqueta, money(imp.importe), ancho));
  }

  // ---- 13 TOTAL ----
  add(izqDer('TOTAL $', money(ticket.total), ancho), { doble: true, enfasis: true });

  // ---- 14 Control de bultos ----
  add(columna(`ARTICULOS: ${ticket.articulos}   RENGLONES: ${ticket.renglones_count}`, ancho));
  blanco();

  // ---- 15 Formas de pago ----
  let huboTarjeta = false;
  for (const p of ticket.pagos || []) {
    if (p.tipo === 'TARJETA') huboTarjeta = true;
    const etiqueta = `${p.tipo}${p.referencia ? '  ' + p.referencia : ''}`;
    // Si la referencia no cabe junto al importe va en su propio renglón:
    // truncarla perdería los últimos 4 dígitos y rompería la conciliación.
    if (p.referencia && etiqueta.length + money(p.importe).length + 2 > ancho) {
      add(izqDer(p.tipo, money(p.importe), ancho));
      for (const parte of envolver(p.referencia, ancho - 2)) add(columna('  ' + parte, ancho));
    } else {
      add(izqDer(etiqueta, money(p.importe), ancho));
    }
  }
  // El cambio se imprime siempre, aunque sea 0.00.
  add(izqDer('SU CAMBIO', money(ticket.cambio || 0), ancho));

  // ---- 16 Autorización ----
  if (B.autorizacion && huboTarjeta) {
    blanco();
    add(centrar(plantilla.leyendas?.autorizacion || '', ancho), { enfasis: true });
  }

  // ---- 17 Bloque promocional ----
  if (B.monedero && ticket.monedero?.length) {
    blanco();
    const chars = MARCOS[plantilla.marco?.estilo === 'cp850' ? 'cp850' : 'ascii'];
    for (const l of marco(ticket.monedero, ancho, chars)) add(columna(l, ancho));
  }

  // ---- 18 Facturación ----
  if (B.facturacion && ticket.facturacion_url) {
    blanco();
    add(centrar('', ancho), { qr: ticket.facturacion_url });
    for (const l of envolver('FACTURA EN: ' + ticket.facturacion_url, ancho)) add(centrar(l, ancho), { fontB: true });
  }

  // ---- 19 Cierre ----
  blanco();
  for (const l of envolver(ticket.leyenda_cierre || plantilla.leyendas?.cierre || '', ancho)) {
    if (l) add(centrar(l, ancho));
  }
  return L;
}

// Salida de texto plano: para vista previa, reimpresión y archivo .txt.
// Es idéntica carácter por carácter a lo que se imprime (criterio 8).
function renderTexto(ticket, ancho, plantilla, opciones = {}) {
  return renderLineas(ticket, ancho, plantilla, opciones).map(l => l.texto).join('\n');
}

// Parte el ticket en páginas sin cortar un renglón a la mitad (criterio 5).
// Solo se usa para la vista previa en pantalla; en papel continuo no aplica.
function paginar(lineas, porPagina) {
  const paginas = [];
  for (let i = 0; i < lineas.length; i += porPagina) {
    paginas.push(lineas.slice(i, i + porPagina));
  }
  return paginas;
}

module.exports = { renderLineas, renderTexto, paginar };
