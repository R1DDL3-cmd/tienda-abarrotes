// Normalización de teclas: convierte un KeyboardEvent a una cadena estable
// ("F4", "Ctrl+K", "Delete") y de vuelta a una etiqueta legible en español
// ("F4", "Ctrl + K", "Supr"). Vive aparte del registro de acciones para que
// no haya import circular: el registro usa esto, y shortcuts.js (compatible
// con la pantalla de Configuración vieja) también.

const KEY_LABELS = {
  ' ': 'Espacio', 'Space': 'Espacio', 'Spacebar': 'Espacio',
  'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
  'Delete': 'Supr', 'Insert': 'Insert', 'Home': 'Inicio', 'End': 'Fin',
  'PageUp': 'Re Pág', 'PageDown': 'Av Pág', 'Enter': 'Enter',
  'Backspace': 'Retroceso', 'Escape': 'Esc', 'Tab': 'Tab',
};

// Teclas que el navegador/SO se reserva y NO se pueden interceptar de forma
// confiable. Se usan para avisar en la pantalla de configuración en vez de
// dejar que el usuario se asigne un atajo que nunca va a funcionar.
export const RESERVED_KEYS = {
  'Ctrl+W': 'El navegador cierra la pestaña',
  'Ctrl+T': 'El navegador abre una pestaña',
  'Ctrl+N': 'El navegador abre una ventana',
  'Ctrl+P': 'El navegador imprime',
  'Alt+F4': 'Windows cierra la ventana',
  'F11': 'Pantalla completa del navegador',
};

// Teclas que solo son 100% confiables dentro de la app de escritorio
// (Electron). En la tablet, el navegador las atrapa primero.
export const DESKTOP_ONLY_KEYS = {
  'F12': 'En el navegador abre las herramientas de desarrollo',
  'Ctrl+K': 'En el navegador enfoca la barra de direcciones',
  'Ctrl+1': 'En el navegador cambia de pestaña',
  'Ctrl+2': 'En el navegador cambia de pestaña',
  'Ctrl+3': 'En el navegador cambia de pestaña',
  'Ctrl+4': 'En el navegador cambia de pestaña',
  'Ctrl+5': 'En el navegador cambia de pestaña',
};

// Convierte un KeyboardEvent a la representación de texto usada para guardar
// y comparar atajos. Acepta cualquier tecla: F1-F12, letras, números,
// símbolos y teclas con nombre (Enter, Supr, Inicio, flechas...), además de
// combinaciones con Ctrl/Alt/Meta. Devuelve null solo para las teclas
// modificadoras solas, porque ahí todavía se está esperando la tecla real.
export function eventToKeyString(e) {
  const k = e.key;
  if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Dead') return null;

  // Orden fijo de modificadores para que capturar y comparar produzcan
  // siempre exactamente la misma cadena.
  let prefix = '';
  if (e.ctrlKey) prefix += 'Ctrl+';
  if (e.altKey) prefix += 'Alt+';
  if (e.metaKey) prefix += 'Meta+';

  let base;
  if (k === ' ' || k === 'Spacebar') base = 'Space';
  else if (k.length === 1) base = k.toUpperCase();
  else base = k;

  return prefix + base;
}

// Etiqueta legible de una tecla guardada. "Delete" -> "Supr", "Ctrl+K" -> "Ctrl + K".
export function keyLabel(keyStr) {
  if (!keyStr) return '';
  const parts = String(keyStr).split('+');
  const base = parts.pop();
  const pretty = KEY_LABELS[base] || base;
  return [...parts, pretty].join(' + ');
}

// ¿Es una tecla "de escritura"? (un solo carácter, sin Ctrl/Alt). Se usa para
// no robarle teclas a la línea de comando ni a los formularios.
export function isTypingKey(e) {
  return e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
}

export function keyWarning(keyStr) {
  if (RESERVED_KEYS[keyStr]) return { level: 'error', text: RESERVED_KEYS[keyStr] };
  if (DESKTOP_ONLY_KEYS[keyStr]) return { level: 'warn', text: DESKTOP_ONLY_KEYS[keyStr] };
  return null;
}
