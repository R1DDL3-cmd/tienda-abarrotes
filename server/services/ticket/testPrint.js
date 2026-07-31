// Prueba de impresión para la INSTALACIÓN. Resuelve dos preguntas que no se
// pueden contestar desde el software:
//
//   1. ¿De cuántas columnas es el papel? Se imprimen reglas de 32, 48 y 64
//      columnas; la más ancha que salga en UNA sola línea (sin doblarse) es
//      la buena. Así el instalador no necesita saber si el rollo es de 58 u
//      80 mm: lo ve en el papel.
//   2. ¿Los acentos salen bien? Se imprime una línea con ñ y vocales
//      acentuadas. Si sale basura, hay que cambiar la página de códigos o
//      activar la transliteración en la plantilla.
const { columna, centrar } = require('./columns');
const { lineasAEscpos } = require('./renderEscpos');

// Regla: marca cada 5 y numera cada 10, para poder contar a simple vista.
function regla(ancho) {
  let s = '';
  for (let i = 1; i <= ancho; i++) {
    if (i % 10 === 0) s += String((i / 10) % 10);
    else if (i % 5 === 0) s += '+';
    else s += '.';
  }
  return s;
}

function lineasPrueba(plantilla) {
  const L = [];
  const add = (texto, estilo) => L.push(estilo ? { texto, ...estilo } : { texto });

  add(centrar('PRUEBA DE IMPRESION', 32), { enfasis: true, doble: true });
  add(' ');
  add('Marca la regla mas larga que');
  add('salga en UNA sola linea:');
  add(' ');
  for (const ancho of [32, 48, 64]) {
    add(`[${ancho}]${regla(ancho).slice(4)}`);
  }
  add(' ');
  add('Acentos: anio ninguno accion');
  add('  ÁÉÍÓÚ áéíóú ñÑ ¿? ¡! 25°');
  add('Si arriba se ven simbolos raros,');
  add('cambia la pagina de codigos en');
  add('Configuracion > Impresora.');
  add(' ');
  add(columna('IZQUIERDA', 32, 'left'));
  add(columna('CENTRADO', 32, 'center'));
  add(columna('DERECHA', 32, 'right'));
  add(' ');
  add(centrar('FIN DE LA PRUEBA', 32), { enfasis: true });
  return L;
}

// Texto plano de la prueba (para la vista previa en pantalla).
function textoPrueba(plantilla) {
  return lineasPrueba(plantilla).map(l => l.texto).join('\n');
}

// Bytes ESC/POS de la prueba. Usa el MISMO traductor de renglones a bytes que
// el ticket real (lineasAEscpos), así que si algo cambia ahí, la prueba lo
// refleja: no hay un segundo camino de impresión que se desincronice.
//
// Se manda sin cortar el papel: el instalador necesita ver la hoja completa
// con las tres reglas juntas para comparar.
function escposPrueba(plantilla) {
  const plantillaPrueba = {
    ...plantilla,
    escpos: { ...(plantilla.escpos || {}), abrir_cajon_con_efectivo: false },
  };
  return lineasAEscpos(lineasPrueba(plantilla), 32, plantillaPrueba, { pagos: [] });
}

module.exports = { lineasPrueba, textoPrueba, escposPrueba, regla };
