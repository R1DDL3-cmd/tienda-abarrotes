// Renderizador ESC/POS. NO calcula layout: consume los mismos renglones que
// renderText.js y solo les agrega los comandos de la impresora (alineación,
// énfasis, doble alto, página de códigos, logo, QR, corte).
const { renderLineas } = require('./renderText');

const ESC = 0x1B, GS = 0x1D;

const CMD = {
  init: [ESC, 0x40],                               // ESC @
  alinear: (n) => [ESC, 0x61, n],                  // 0 izq, 1 centro, 2 der
  fuente: (n) => [ESC, 0x4D, n],                   // 0 = A, 1 = B
  enfasis: (on) => [ESC, 0x45, on ? 1 : 0],        // ESC E
  tamano: (n) => [GS, 0x21, n],                    // GS ! (0x11 = doble alto+ancho)
  codepage: (n) => [ESC, 0x74, n],                 // ESC t
  avance: (n) => [ESC, 0x64, n],                   // ESC d
  corteParcial: [GS, 0x56, 0x01],                  // GS V 1
  corteTotal: [GS, 0x56, 0x00],
  cajon: [ESC, 0x70, 0x00, 0x19, 0xFA],            // ESC p 0 25 250
};

// Mapa mínimo de CP850 para español. Solo lo que de verdad aparece en un
// ticket mexicano; el resto cae a transliteración.
const CP850 = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ü': 0x81,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'Ü': 0x9A,
  'ñ': 0xA4, 'Ñ': 0xA5, '¿': 0xA8, '¡': 0xAD, '°': 0xF8, 'º': 0xA7, 'ª': 0xA6,
  '│': 0xB3, '┌': 0xDA, '┐': 0xBF, '└': 0xC0, '┘': 0xD9, '─': 0xC4,
};

const TRANSLIT = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n',
  'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U','Ü':'U','Ñ':'N',
  '¿':'?','¡':'!','°':'o','º':'o','ª':'a',
  '│':'|','┌':'+','┐':'+','└':'+','┘':'+','─':'-',
};

// Codifica un renglón a bytes. Si `translit` está activo, primero reemplaza
// los acentos por su letra simple (respaldo para impresoras que no responden
// bien a ninguna página de códigos).
function encodeLinea(texto, { translit = false } = {}) {
  const bytes = [];
  for (const ch of String(texto)) {
    if (translit && TRANSLIT[ch]) {
      bytes.push(TRANSLIT[ch].charCodeAt(0));
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 128) { bytes.push(code); continue; }
    if (CP850[ch] !== undefined) { bytes.push(CP850[ch]); continue; }
    // Carácter desconocido: se transliteran o se sustituye, nunca se manda
    // un byte que la impresora interprete como comando.
    bytes.push((TRANSLIT[ch] || '?').charCodeAt(0));
  }
  return bytes;
}

// Bitmap raster del logo (GS v 0). Recibe { width, height, data } donde data
// son bytes 1bpp ya empaquetados (MSB primero), width en píxeles.
function comandoLogo(logo) {
  if (!logo || !logo.data || !logo.width || !logo.height) return [];
  const anchoBytes = Math.ceil(logo.width / 8);
  return [
    GS, 0x76, 0x30, 0x00,
    anchoBytes & 0xFF, (anchoBytes >> 8) & 0xFF,
    logo.height & 0xFF, (logo.height >> 8) & 0xFF,
    ...Array.from(logo.data),
  ];
}

// Código QR (GS ( k). Modelo 2, corrección M.
function comandoQR(texto, tamano = 6) {
  const datos = Buffer.from(String(texto), 'utf8');
  const len = datos.length + 3;
  return [
    GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,      // modelo 2
    GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, tamano,          // tamaño del módulo
    GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31,            // corrección M
    GS, 0x28, 0x6B, len & 0xFF, (len >> 8) & 0xFF, 0x31, 0x50, 0x30, ...datos,
    GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30,            // imprimir
  ];
}

// ¿El renglón está centrado? Se deduce del propio texto (espacios simétricos),
// para no tener que duplicar la intención de alineación en dos renderizadores.
function detectarCentrado(texto) {
  const izq = texto.length - texto.trimStart().length;
  const der = texto.length - texto.trimEnd().length;
  return izq > 1 && Math.abs(izq - der) <= 1;
}

// Traduce una lista de renglones ya formados a bytes ESC/POS. Se expone
// aparte para que la prueba de impresión (testPrint.js) use exactamente este
// mismo camino con sus propios renglones, en vez de tener un segundo
// generador que se pueda desincronizar del real.
function lineasAEscpos(lineas, ancho, plantilla, ticket = {}) {
  const cfg = plantilla.escpos || {};
  const out = [];
  const push = (arr) => out.push(...arr);

  push(CMD.init);
  if (cfg.codepage !== undefined) push(CMD.codepage(cfg.codepage));
  const rejilla = plantilla.rejillas[String(ancho)];
  if (rejilla?.font === 'B') push(CMD.fuente(1));

  let alineacionActual = 0, enfasisActual = false, tamanoActual = 0, fuenteActual = rejilla?.font === 'B' ? 1 : 0;

  for (const l of lineas) {
    if (l.logo && ticket.negocio?.logo_raster) {
      push(CMD.alinear(1)); alineacionActual = 1;
      push(comandoLogo(ticket.negocio.logo_raster));
      push([0x0A]);
      continue;
    }
    if (l.qr) {
      push(CMD.alinear(1)); alineacionActual = 1;
      push(comandoQR(l.qr));
      push([0x0A]);
      continue;
    }

    // Alineación: si el texto ya viene centrado con espacios, se manda
    // centrado y sin relleno para que la impresora lo centre de verdad
    // (con papel angosto el relleno manual desperdicia columnas).
    const centrado = detectarCentrado(l.texto);
    const destino = centrado ? 1 : 0;
    if (destino !== alineacionActual) { push(CMD.alinear(destino)); alineacionActual = destino; }

    const quiereFontB = !!l.fontB;
    const fuenteDestino = quiereFontB ? 1 : (rejilla?.font === 'B' ? 1 : 0);
    if (fuenteDestino !== fuenteActual) { push(CMD.fuente(fuenteDestino)); fuenteActual = fuenteDestino; }

    if (!!l.enfasis !== enfasisActual) { push(CMD.enfasis(!!l.enfasis)); enfasisActual = !!l.enfasis; }

    const tamanoDestino = l.doble ? 0x11 : 0x00;
    if (tamanoDestino !== tamanoActual) { push(CMD.tamano(tamanoDestino)); tamanoActual = tamanoDestino; }

    push(encodeLinea(centrado ? l.texto.trim() : l.texto, { translit: cfg.translit }));
    push([0x0A]);
  }

  // Volver a valores neutros antes de cortar
  if (enfasisActual) push(CMD.enfasis(false));
  if (tamanoActual) push(CMD.tamano(0));
  if (alineacionActual) push(CMD.alinear(0));

  push(CMD.avance(cfg.avance_lineas ?? 4));
  push(cfg.corte === 'total' ? CMD.corteTotal : CMD.corteParcial);

  // El cajón solo se abre si de verdad entró efectivo.
  if (cfg.abrir_cajon_con_efectivo && (ticket.pagos || []).some(p => p.tipo === 'EFECTIVO')) {
    push(CMD.cajon);
  }

  return Buffer.from(out);
}

function renderEscpos(ticket, ancho, plantilla, opciones = {}) {
  const lineas = renderLineas(ticket, ancho, plantilla, opciones);
  return lineasAEscpos(lineas, ancho, plantilla, ticket);
}

module.exports = { renderEscpos, lineasAEscpos, encodeLinea, comandoQR, comandoLogo, CMD };
