// Fecha de negocio de la tienda (zona centro de México, UTC-6 fijo, sin
// horario de verano — mismo criterio que frontend/src/dateUtils.js).
//
// El backend guarda created_at en UTC (datetime('now') de SQLite). Antes,
// "hoy" también se calculaba en UTC, así que el día contable cambiaba a las
// 6:00 PM hora local: una venta de las 7 PM caía en el corte de caja del día
// SIGUIENTE. Todo agrupamiento por día (corte, dashboard, reportes, filtros
// de fecha) debe pasar por estas dos funciones para que el día corte a
// medianoche hora de la tienda.
const BUSINESS_UTC_OFFSET_HOURS = -6;

// Fecha calendario (YYYY-MM-DD) de "ahora" en hora de la tienda.
function businessToday() {
  return businessNow().toISOString().split('T')[0];
}

// "Ahora" desplazado a hora de la tienda — solo para derivar fechas
// calendario (semana pasada, mes pasado) con métodos UTC/toISOString.
function businessNow() {
  return new Date(Date.now() + BUSINESS_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

// Expresión SQL que convierte una columna datetime UTC a la fecha calendario
// en hora de la tienda. Usar SIEMPRE en lugar de date(col) al agrupar o
// filtrar por día.
function bizDate(col) {
  return `date(${col}, '${BUSINESS_UTC_OFFSET_HOURS} hours')`;
}

module.exports = { businessToday, businessNow, bizDate, BUSINESS_UTC_OFFSET_HOURS };
