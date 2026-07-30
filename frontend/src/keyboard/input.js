// CAPA DE ENTRADA — un solo listener global que traduce teclas a acciones
// del registro. Los componentes nunca escuchan teclas por su cuenta: solo
// declaran su acción en el registro y pasan aquí el handler.

import { useEffect, useRef } from 'react';
import { eventToKeyString, isTypingKey } from './keys.js';
import { resolveKey } from './registry.js';

// Un lector de código de barras "teclea" mucho más rápido que una persona:
// ráfagas con menos de ~30 ms entre teclas. Detectarlo permite (1) no dejar
// que un dígito del código dispare un atajo de una sola tecla y (2) tratar la
// ráfaga como una sola lectura al llegar el Enter final.
export const SCANNER_MAX_GAP_MS = 30;
const SCANNER_MIN_KEYS = 3;   // ráfaga confirmada a partir de la 3ª tecla rápida
const SCANNER_IDLE_MS = 120;  // sin teclas por este tiempo, se acabó la ráfaga

export function createScannerDetector({ maxGap = SCANNER_MAX_GAP_MS, minKeys = SCANNER_MIN_KEYS, idle = SCANNER_IDLE_MS } = {}) {
  let lastTime = 0;
  let fastCount = 0;
  let scanning = false;

  return {
    // Se llama con cada keydown. Devuelve true si en este momento se está
    // recibiendo una ráfaga de lector.
    push(now = Date.now()) {
      const gap = now - lastTime;
      if (gap > idle) {
        fastCount = 0;
        scanning = false;
      } else if (gap <= maxGap) {
        fastCount++;
        if (fastCount >= minKeys) scanning = true;
      } else {
        fastCount = 0;
        scanning = false;
      }
      lastTime = now;
      return scanning;
    },
    isScanning() { return scanning; },
    // El Enter del lector cierra la lectura.
    end() { fastCount = 0; scanning = false; },
    reset() { lastTime = 0; fastCount = 0; scanning = false; },
  };
}

// ¿El foco está en un campo donde el usuario está escribiendo algo que no es
// la línea de comando? (otro input, textarea, select o campo editable)
function isForeignField(target, commandLineEl) {
  if (!target || target === commandLineEl) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!target.isContentEditable;
}

/**
 * Hook único de teclado.
 *
 * @param {string}   state              estado actual (ver STATES)
 * @param {string}   role               rol del usuario
 * @param {object}   handlers           { [actionId]: (action, event) => void }
 * @param {function} isCommandLineEmpty () => boolean
 * @param {object}   commandLineRef     ref al input de la línea de comando
 * @param {boolean}  enabled            permite apagar la capa (ej. sin turno)
 * @param {function} onScanStateChange  opcional, avisa cuando entra/sale de ráfaga
 */
export function useKeyboardLayer({
  state, role, handlers, isCommandLineEmpty,
  commandLineRef, enabled = true, onScanStateChange,
}) {
  // Los handlers cambian en cada render; se guardan en un ref para poder
  // registrar el listener UNA sola vez y que siempre vea la versión fresca.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const stateRef = useRef(state);
  stateRef.current = state;
  const roleRef = useRef(role);
  roleRef.current = role;
  const emptyRef = useRef(isCommandLineEmpty);
  emptyRef.current = isCommandLineEmpty;
  const scannerRef = useRef(null);
  if (!scannerRef.current) scannerRef.current = createScannerDetector();

  useEffect(() => {
    if (!enabled) return;
    const scanner = scannerRef.current;

    const onKeyDown = (e) => {
      const commandLineEl = commandLineRef?.current || null;
      const scanning = scanner.push();
      if (onScanStateChange) onScanStateChange(scanning);

      if (e.key === 'Enter') scanner.end();

      const keyString = eventToKeyString(e);
      if (!keyString) return;

      // Durante una ráfaga del lector, ninguna tecla de un solo carácter debe
      // disparar acciones: son dígitos del código de barras.
      if (scanning && isTypingKey(e)) return;

      // Escribiendo en otro campo: solo se permiten atajos con modificador o
      // teclas de función, nunca robarle una letra a un formulario.
      if (isForeignField(e.target, commandLineEl) && isTypingKey(e)) return;

      const action = resolveKey(keyString, { state: stateRef.current, role: roleRef.current });
      if (!action) return;

      // Acciones como "+", "-" o "Supr" solo aplican al ticket si la línea de
      // comando está vacía; si hay texto, son escritura normal.
      if (action.needsEmptyInput) {
        const empty = emptyRef.current ? emptyRef.current() : true;
        if (!empty) return;
      }

      const handler = handlersRef.current ? handlersRef.current[action.id] : null;
      if (!handler) return;

      e.preventDefault();
      e.stopPropagation();
      handler(action, e);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, commandLineRef, onScanStateChange]);

  return scannerRef.current;
}

// Devuelve el foco a la línea de comando. Se llama después de CUALQUIER
// operación, incluso las que fallan: el usuario nunca debe buscar dónde
// escribir (principio 1 y criterio de aceptación 3).
export function focusCommandLine(ref, { delay = 0 } = {}) {
  const doFocus = () => {
    const el = ref && ref.current;
    if (el && typeof el.focus === 'function') {
      el.focus();
      if (typeof el.select === 'function' && el.value) el.select();
    }
  };
  if (delay > 0) setTimeout(doFocus, delay);
  else doFocus();
}
