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

const PALETTE_VARS = {
  primary: ['--primary', '--primary-light', '--primary-dark'],
  success: ['--success', '--success-light', '--success-dark'],
  danger: ['--danger', '--danger-light', '--danger-dark'],
  warning: ['--warning', null, '--warning-dark']
}

export function applyPalette(colors) {
  const root = document.documentElement.style
  for (const key of Object.keys(PALETTE_VARS)) {
    const hex = colors?.[key]
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
