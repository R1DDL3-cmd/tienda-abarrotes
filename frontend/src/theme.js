export function getTheme() {
  return localStorage.getItem('theme') || 'light'
}

export function setTheme(theme) {
  localStorage.setItem('theme', theme)
  document.documentElement.setAttribute('data-theme', theme)
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

// ---------------------------------------------------------------
// ESTÉTICA (skin) — eje independiente del claro/oscuro
//
//   moderno    = la interfaz de siempre (tarjetas, radios, sombras)
//   enterprise = herramienta de trabajo: cuadrada, densa, sin adorno
//
// Ambas comparten el mismo marcado y las mismas clases: lo único que cambia
// son los tokens de tokens.css y la capa enterprise.css. Por eso cambiar de
// estética es instantáneo y no re-renderiza React.
// ---------------------------------------------------------------
export const SKINS = { MODERNO: 'moderno', ENTERPRISE: 'enterprise' }
const SKIN_KEY = 'skin'

export function getSkin() {
  return localStorage.getItem(SKIN_KEY) === SKINS.ENTERPRISE ? SKINS.ENTERPRISE : SKINS.MODERNO
}

export function setSkin(skin) {
  const value = skin === SKINS.ENTERPRISE ? SKINS.ENTERPRISE : SKINS.MODERNO
  localStorage.setItem(SKIN_KEY, value)
  document.documentElement.setAttribute('data-skin', value)
  // La paleta personalizada se escribe como estilos en línea sobre <html>, que
  // ganan a cualquier hoja de estilo: si no se retira, los colores de marca
  // pisarían la paleta neutra de la estética clásica. Al volver a moderno se
  // reaplica tal cual estaba.
  applyPalette(_lastPalette)
  return value
}

export function toggleSkin() {
  return setSkin(getSkin() === SKINS.ENTERPRISE ? SKINS.MODERNO : SKINS.ENTERPRISE)
}

// Se llama ANTES del primer render (main.jsx) para que la app nunca aparezca
// un instante con la estética o el tema equivocados.
export function applyStoredAppearance() {
  document.documentElement.setAttribute('data-theme', getTheme())
  document.documentElement.setAttribute('data-skin', getSkin())
}

// Colores de marca personalizables (independiente de claro/oscuro, que sigue
// controlando fondo/texto/bordes vía data-theme). Solo se sobreescriben las
// variables de marca — si falta o es inválido un color, se limpia esa
// variable y el CSS vuelve a su valor por defecto del tema activo.
function shade(hex, percent) {
  const num = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp((num >> 16) + Math.round(2.55 * percent))
  const g = clamp(((num >> 8) & 0xff) + Math.round(2.55 * percent))
  const b = clamp((num & 0xff) + Math.round(2.55 * percent))
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)
}

// Cada color de la paleta mapea a una o más variables CSS. Los que tienen
// tono claro/oscuro derivan esos tonos automáticamente (shade). Los de la
// barra de navegación (header_bg, header_text) y el acento son de una sola
// variable.
const PALETTE_VARS = {
  primary: ['--primary', '--primary-light', '--primary-dark'],
  success: ['--success', '--success-light', '--success-dark'],
  danger: ['--danger', '--danger-light', '--danger-dark'],
  warning: ['--warning', null, '--warning-dark'],
  header_bg: ['--header-bg', null, null],
  header_text: ['--header-text', null, null],
  accent: ['--bg-accent', null, null]
}

// Última paleta pedida por el servidor/usuario. Se recuerda para poder
// reaplicarla al volver de la estética clásica (que la ignora a propósito).
let _lastPalette = null

export function applyPalette(colors) {
  _lastPalette = colors || null
  const root = document.documentElement.style
  // Estética clásica: paleta neutra obligatoria. El color solo aparece cuando
  // significa algo (azul acción, verde éxito, naranja aviso, rojo error), así
  // que los colores de marca configurables no se aplican aquí.
  const neutral = getSkin() === SKINS.ENTERPRISE
  for (const key of Object.keys(PALETTE_VARS)) {
    const hex = neutral ? null : colors?.[key]
    const [base, light, dark] = PALETTE_VARS[key]
    if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      root.setProperty(base, hex)
      if (light) root.setProperty(light, shade(hex, 15))
      if (dark) root.setProperty(dark, shade(hex, -15))
    } else {
      root.removeProperty(base)
      if (light) root.removeProperty(light)
      if (dark) root.removeProperty(dark)
    }
  }
}

export function clearPalette() {
  applyPalette({})
}
