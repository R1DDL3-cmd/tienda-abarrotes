// Capa de compatibilidad. El registro central de acciones
// (keyboard/registry.js) es la ÚNICA fuente de verdad de las teclas; este
// módulo solo traduce a la forma { id: { key, label } } que espera la
// pantalla de Configuración actual, para no tener que reescribirla de golpe.
//
// Al migrar Configuración al registro (ver plan de migración), este archivo
// se puede borrar.
import { allActions, keysFor, setKeys, resetKeys } from './keyboard/registry.js';
import { eventToKeyString } from './keyboard/keys.js';

export { eventToKeyString, keyLabel } from './keyboard/keys.js';

// Acciones que se muestran en la pantalla de configuración de teclas: solo
// las que de verdad tienen atajo asignable.
function configurableActions() {
  return allActions().filter(a => a.keys && a.keys.length > 0);
}

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  configurableActions().map(a => [a.id, { key: a.keys[0], label: a.nombre, hash: a.hash }])
);

export function getShortcuts() {
  const out = {};
  for (const a of configurableActions()) {
    const keys = keysFor(a.id);
    out[a.id] = { key: keys[0], keys, label: a.nombre, hash: a.hash };
  }
  return out;
}

export function setShortcutKey(id, key) {
  setKeys(id, [key]);
}

export function resetShortcuts() {
  resetKeys();
}

// Comparación de una tecla presionada contra un atajo guardado. Acepta
// cualquiera de los alias de la acción (ej. F4 y F12 para cobrar).
export function matchesShortcut(e, shortcut) {
  if (!shortcut) return false;
  const pressed = eventToKeyString(e);
  if (pressed === null) return false;
  const list = shortcut.keys && shortcut.keys.length ? shortcut.keys : [shortcut.key];
  return list.includes(pressed);
}
