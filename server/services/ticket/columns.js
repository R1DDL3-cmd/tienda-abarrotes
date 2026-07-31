// Utilidad ÚNICA de formato del ticket. Todo el layout —encabezados,
// renglones, totales, marcos— se construye con estas funciones; ninguna otra
// parte del código debe calcular espacios a mano. Así el ancho del papel se
// cambia en un solo lugar y la rejilla nunca se desalinea.

// Corta o rellena un texto para que ocupe EXACTAMENTE `ancho` caracteres.
function columna(texto, ancho, alineacion = 'left', truncar = true) {
  let s = texto === null || texto === undefined ? '' : String(texto);
  if (truncar && s.length > ancho) s = s.slice(0, ancho);
  if (s.length > ancho) s = s.slice(0, ancho);
  if (alineacion === 'right') return s.padStart(ancho);
  if (alineacion === 'center') {
    const total = ancho - s.length;
    const izq = Math.floor(total / 2);
    return ' '.repeat(izq) + s + ' '.repeat(total - izq);
  }
  return s.padEnd(ancho);
}

function centrar(texto, ancho) {
  return columna(texto, ancho, 'center');
}

// Etiqueta a la izquierda, importe pegado a la derecha, con una separación
// mínima garantizada: sin ella una etiqueta larga queda pegada al número y se
// lee "ABARROTE12.00".
function izqDer(izquierda, derecha, ancho, sepMin = 2) {
  const der = String(derecha ?? '');
  const espacio = ancho - der.length - sepMin;
  if (espacio < 1) return columna(der, ancho, 'right');
  return columna(izquierda, espacio, 'left') + ' '.repeat(sepMin) + der;
}

// Parte un texto por palabras. Se usa para leyendas y direcciones, NO para la
// descripción de artículos (esa se trunca, por convención de supermercado).
function envolver(texto, ancho) {
  const palabras = String(texto ?? '').split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const p of palabras) {
    if (!actual) actual = p;
    else if (actual.length + 1 + p.length <= ancho) actual += ' ' + p;
    else { lineas.push(actual); actual = p; }
    // Una sola palabra más larga que el ancho: se parte a la fuerza.
    while (actual.length > ancho) {
      lineas.push(actual.slice(0, ancho));
      actual = actual.slice(ancho);
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

// Marco dibujado con caracteres. `chars` permite usar los de caja de CP850
// cuando la impresora los soporta, o degradar a + - | cuando no.
function marco(lineas, ancho, chars = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }) {
  const interior = ancho - 4;
  const out = [chars.tl + chars.h.repeat(ancho - 2) + chars.tr];
  for (const l of lineas) {
    if (Array.isArray(l)) {
      // [etiqueta, importe] -> se separan a los extremos
      out.push(chars.v + ' ' + izqDer(l[0], l[1], interior) + ' ' + chars.v);
    } else {
      // Las leyendas se ENVUELVEN, no se truncan: cortar "expira 7 dias
      // despues de la compra" a la mitad la vuelve inservible.
      for (const parte of envolver(l, interior)) {
        out.push(chars.v + ' ' + columna(parte, interior, 'left') + ' ' + chars.v);
      }
    }
  }
  out.push(chars.bl + chars.h.repeat(ancho - 2) + chars.br);
  return out;
}

// Importes SIEMPRE en centavos (enteros). Nunca punto flotante para dinero:
// 0.1 + 0.2 !== 0.3 y el ticket dejaría de cuadrar con el corte de caja.
function money(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return signo + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

// Convierte pesos (float, como vienen de la BD) a centavos enteros.
function aCentavos(pesos) {
  return Math.round((Number(pesos) || 0) * 100);
}

module.exports = { columna, centrar, izqDer, envolver, marco, money, aCentavos };
