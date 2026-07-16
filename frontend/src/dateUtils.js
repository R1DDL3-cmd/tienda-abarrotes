// Utilidades de fecha/hora — centralizan dos correcciones que antes se hacían
// (o NO se hacían) de forma inconsistente en cada pantalla:
//
// 1. El backend guarda created_at con SQLite datetime("now"), que es UTC pero
//    se formatea como "YYYY-MM-DD HH:MM:SS" (sin 'Z' ni offset). new Date()
//    interpreta ese formato como hora LOCAL del navegador, no UTC — hay que
//    forzar la interpretación UTC agregando 'Z' antes de parsear.
//
// 2. Electron 22 (usado por esta app) trae empaquetada una versión de
//    Chromium/ICU anterior a que México eliminara el horario de verano
//    (decreto de 2022): resuelve America/Mexico_City a GMT-5 en verano
//    cuando debería ser GMT-6 todo el año. Confirmado en vivo: el reloj de
//    la app salía 1 hora adelantado. En vez de confiar en `timeZone:
//    'America/Mexico_City'` (que hereda ese bug), se aplica el offset fijo
//    manualmente y se formatea como UTC (que cualquier ICU resuelve bien).
//
// Asume zona centro de México sin horario de verano (UTC-6 todo el año).
// Si la tienda estuviera en una franja fronteriza con horario de verano,
// esto habría que hacerlo configurable — no es el caso por ahora.
const MX_OFFSET_HOURS = 6;
const MANUAL_OFFSET_KEY = 'manual_time_offset_hours';

// Ajuste manual adicional, por si el offset fijo de arriba no cae exacto
// (ej. una actualización de Electron cambia el comportamiento, o la tienda
// está en otra zona horaria). Se guarda en horas, admite decimales para
// minutos (0.5 = media hora). Por defecto 0 — no cambia nada del cálculo ya
// corregido a menos que alguien lo ajuste desde Configuración.
export function getManualOffsetHours() {
  const raw = localStorage.getItem(MANUAL_OFFSET_KEY);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function setManualOffsetHours(hours) {
  localStorage.setItem(MANUAL_OFFSET_KEY, String(hours));
}

export function parseServerDate(value) {
  if (!value) return null;
  const iso = value instanceof Date ? value : new Date(
    typeof value === 'string' && !value.includes('Z') && !value.includes('+')
      ? value.replace(' ', 'T') + 'Z'
      : value
  );
  return new Date(iso.getTime() - (MX_OFFSET_HOURS - getManualOffsetHours()) * 60 * 60 * 1000);
}

export function formatDateTime(value, opts = {}) {
  const d = parseServerDate(value);
  if (!d) return '-';
  return d.toLocaleString('es-MX', { timeZone: 'UTC', ...opts });
}

export function formatDate(value, opts = {}) {
  const d = parseServerDate(value);
  if (!d) return '-';
  return d.toLocaleDateString('es-MX', { timeZone: 'UTC', ...opts });
}

export function formatTime(value, opts = {}) {
  const d = parseServerDate(value);
  if (!d) return '-';
  return d.toLocaleTimeString('es-MX', { timeZone: 'UTC', ...opts });
}

// Para fechas SIN hora (expiry_date, start_date de eventos, etc.) — NO debe
// pasar por el ajuste de -6h de arriba, porque eso está pensado para
// convertir un instante UTC a hora local, y una fecha pura no es un instante:
// aplicarle el shift la corre un día para atrás cerca de medianoche. Se ancla
// a mediodía local para evitar cualquier problema de borde de zona horaria.
export function formatCalendarDate(value, opts = {}) {
  if (!value) return '-';
  const datePart = typeof value === 'string' ? value.split('T')[0].split(' ')[0] : value;
  const d = new Date(`${datePart}T12:00:00`);
  return d.toLocaleDateString('es-MX', opts);
}

// Compara si dos timestamps del servidor caen en el mismo día calendario en
// hora de tienda (Mexico City). No usar .toDateString() directo sobre el
// resultado de parseServerDate: ya viene con el shift de -6h aplicado sobre
// el epoch, así que volver a interpretarlo en la zona horaria LOCAL del
// sistema lo convertiría por segunda vez.
export function isSameLocalDay(a, b) {
  const da = parseServerDate(a);
  const db = parseServerDate(b);
  if (!da || !db) return false;
  return da.toISOString().split('T')[0] === db.toISOString().split('T')[0];
}

// Para el reloj en vivo del header: "now" ya es la hora local correcta del
// sistema operativo (confirmado: Windows tiene bien la hora) — el bug solo
// aparece al forzar la conversión vía timeZone: 'America/Mexico_City'. Por
// eso aquí NO se re-convierte, solo se le aplica el ajuste manual (si hay
// uno configurado) para que el reloj y los tickets/historial queden
// consistentes entre sí.
export function formatLiveClock(date, opts = {}) {
  const manual = getManualOffsetHours();
  const adjusted = manual ? new Date(date.getTime() + manual * 60 * 60 * 1000) : date;
  return adjusted.toLocaleString('es-MX', opts);
}
