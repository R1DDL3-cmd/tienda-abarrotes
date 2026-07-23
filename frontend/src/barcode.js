// Generador de códigos de barras Code 128 en SVG puro, sin librerías.
// Code 128 codifica cualquier texto ASCII imprimible (sirve tanto para
// códigos EAN numéricos como para los generados tipo "BAR-XXXX"), y
// cualquier lector de códigos moderno lo entiende.
//
// Tabla estándar de patrones Code 128 (valores 0-106): cada patrón son 6
// dígitos que alternan anchos de barra/espacio (en módulos). El símbolo de
// alto (STOP, valor 106) tiene 7 dígitos.
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

// Convierte el texto a la secuencia de valores Code 128 (juego B) con su
// dígito verificador. Devuelve null si el texto trae caracteres fuera del
// rango imprimible ASCII (32-126).
function encode128B(text) {
  if (text === null || text === undefined) return null;
  const s = String(text);
  if (!s) return null; // sin código: el que llama muestra el texto de respaldo
  const values = [START_B];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return null;
    values.push(code - 32);
  }
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(STOP);
  return values;
}

// Genera el SVG del código de barras. Devuelve '' si el texto no es
// codificable (el que llama decide qué mostrar en su lugar).
export function barcodeSVG(text, { height = 44, moduleWidth = 2, showText = true } = {}) {
  const values = encode128B(text);
  if (!values) return '';

  // Ancho total en módulos (con zona muda de 10 módulos por lado)
  const quiet = 10;
  let totalModules = quiet * 2;
  for (const v of values) for (const d of CODE128_PATTERNS[v]) totalModules += parseInt(d, 10);

  const width = totalModules * moduleWidth;
  const textHeight = showText ? 14 : 0;
  const svgHeight = height + textHeight;

  let x = quiet * moduleWidth;
  let bars = '';
  for (const v of values) {
    const pattern = CODE128_PATTERNS[v];
    for (let i = 0; i < pattern.length; i++) {
      const w = parseInt(pattern[i], 10) * moduleWidth;
      // Posiciones pares son barras (negro), impares son espacios
      if (i % 2 === 0) {
        bars += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
      }
      x += w;
    }
  }

  const label = showText
    ? `<text x="${width / 2}" y="${height + 11}" font-family="monospace" font-size="11" text-anchor="middle" fill="#000">${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}">` +
    `<rect width="${width}" height="${svgHeight}" fill="#fff"/>${bars}${label}</svg>`;
}
