const { getDB } = require('../db');

// ============================================================
// FERIADOS MEXICANOS PRECARGADOS (generacion por año)
// ============================================================
const FERIADOS_FIJOS = [
  { name: 'Ano Nuevo', month: 1, day: 1 },
  { name: 'Dia de la Constitucion', month: 2, day: 5 },
  { name: 'Natalicio de Benito Juarez', month: 3, day: 21 },
  { name: 'Dia del Trabajo', month: 5, day: 1 },
  { name: 'Dia de la Independencia', month: 9, day: 16 },
  { name: 'Dia de Muertos', month: 11, day: 2 },
  { name: 'Dia de la Revolucion', month: 11, day: 20 },
  { name: 'Navidad', month: 12, day: 25 },
];

const EVENTOS_DEPORTIVOS_FIJOS = [
  { name: 'Super Bowl', rule: 'second_sunday_february', type: 'sports' },
  { name: 'Final de Champions League', rule: 'first_saturday_june', type: 'sports' },
  { name: 'Mundial de Futbol', rule: 'world_cup_years', type: 'sports' },
];

const PROMOCIONES_FIJAS = [
  { name: 'Buen Fin', rule: 'third_thursday_november', days: 4, type: 'promotion' },
  { name: 'Hot Sale', rule: 'fourth_monday_may', days: 5, type: 'promotion' },
  { name: 'El Buen Fin', rule: 'third_thursday_november', days: 4, type: 'promotion' },
];

function getNthWeekdayOfMonth(year, month, weekday, n) {
  let count = 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === weekday) {
      count++;
      if (count === n) return d;
    }
  }
  return null;
}

function generatePreloadedEvents(year) {
  const events = [];

  for (const f of FERIADOS_FIJOS) {
    events.push({
      name: f.name, type: 'holiday',
      start_date: `${year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`,
      end_date: `${year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`,
      impact_expected: 'high', is_recurring: 1, source: 'preloaded',
    });
  }

  // Super Bowl: segundo domingo de febrero
  const sbDay = getNthWeekdayOfMonth(year, 2, 0, 2);
  if (sbDay) {
    events.push({
      name: 'Super Bowl', type: 'sports',
      start_date: `${year}-02-${String(sbDay).padStart(2, '0')}`,
      end_date: `${year}-02-${String(sbDay).padStart(2, '0')}`,
      impact_expected: 'medium', is_recurring: 1, source: 'preloaded',
    });
  }

  // Buen Fin: tercer jueves de noviembre
  const bfDay = getNthWeekdayOfMonth(year, 11, 4, 3);
  if (bfDay) {
    const bfEnd = bfDay + 3;
    events.push({
      name: 'Buen Fin', type: 'promotion',
      start_date: `${year}-11-${String(bfDay).padStart(2, '0')}`,
      end_date: `${year}-11-${String(Math.min(bfEnd, 30)).padStart(2, '0')}`,
      impact_expected: 'high', is_recurring: 1, source: 'preloaded',
    });
  }

  // Hot Sale: cuarto lunes de mayo
  const hsDay = getNthWeekdayOfMonth(year, 5, 1, 4);
  if (hsDay) {
    const hsEnd = hsDay + 4;
    events.push({
      name: 'Hot Sale', type: 'promotion',
      start_date: `${year}-05-${String(hsDay).padStart(2, '0')}`,
      end_date: `${year}-05-${String(Math.min(hsEnd, 31)).padStart(2, '0')}`,
      impact_expected: 'medium', is_recurring: 1, source: 'preloaded',
    });
  }

  return events;
}

// ============================================================
// Sincronizar eventos precargados a DB
// ============================================================
function syncPreloadedEvents(year) {
  const db = getDB();
  const existing = db.prepare("SELECT name, start_date FROM events WHERE source='preloaded' AND start_date LIKE ?").all(`${year}-%`);
  const existingMap = new Set(existing.map(e => `${e.name}|${e.start_date}`));

  const preloaded = generatePreloadedEvents(year);

  const insert = db.prepare(`INSERT OR IGNORE INTO events (name, type, start_date, end_date, impact_expected, is_recurring, source) VALUES (?, ?, ?, ?, ?, 1, 'preloaded')`);

  const tx = db.transaction(() => {
    for (const e of preloaded) {
      const key = `${e.name}|${e.start_date}`;
      if (!existingMap.has(key)) {
        insert.run(e.name, e.type, e.start_date, e.end_date, e.impact_expected);
      }
    }
  });
  tx();
}

// ============================================================
// CRUD de eventos
// ============================================================
function listEvents(filters = {}) {
  const db = getDB();
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (filters.type) { sql += ' AND type = ?'; params.push(filters.type); }
  if (filters.from) { sql += ' AND start_date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND start_date <= ?'; params.push(filters.to); }
  if (filters.branch_id) { sql += ' AND (branch_id = ? OR branch_id = 0)'; params.push(filters.branch_id); }
  if (filters.upcoming) {
    sql += " AND start_date >= date('now')";
  }
  sql += ' ORDER BY start_date ASC, name ASC';
  return db.prepare(sql).all(...params);
}

function getEvent(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function createEvent(data) {
  const db = getDB();
  const stmt = db.prepare(`INSERT INTO events (name, description, type, start_date, end_date, branch_id, impact_expected, is_recurring, recurring_rule, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const result = stmt.run(
    data.name, data.description || null, data.type || 'local',
    data.start_date, data.end_date || data.start_date,
    data.branch_id || 0, data.impact_expected || 'medium',
    data.is_recurring ? 1 : 0, data.recurring_rule || null,
    data.source || 'manual', data.created_by || null
  );
  return getEvent(result.lastInsertRowid);
}

function updateEvent(id, data) {
  const db = getDB();
  const fields = [];
  const params = [];
  for (const key of ['name', 'description', 'type', 'start_date', 'end_date', 'branch_id', 'impact_expected', 'is_recurring', 'recurring_rule']) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  if (fields.length === 0) return getEvent(id);
  params.push(id);
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getEvent(id);
}

function deleteEvent(id) {
  const db = getDB();
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return { success: true };
}

// ============================================================
// MEDICION DE IMPACTO POST-EVENTO
// ============================================================
function measureEventImpact(eventId) {
  const db = getDB();
  const event = getEvent(eventId);
  if (!event) return null;

  // Ventas promedio 30 dias antes del evento
  const beforeEnd = new Date(event.start_date);
  beforeEnd.setDate(beforeEnd.getDate() - 1);
  const beforeStart = new Date(beforeEnd);
  beforeStart.setDate(beforeStart.getDate() - 30);

  const avgBefore = db.prepare(`
    SELECT AVG(daily.total) as avg_sales FROM (
      SELECT date(s.created_at) as d, SUM(s.total) as total
      FROM sales s WHERE s.status = 'completed'
        AND date(s.created_at) BETWEEN ? AND ?
      GROUP BY d
    ) daily
  `).get(beforeStart.toISOString().split('T')[0], beforeEnd.toISOString().split('T')[0]);

  const expectedDaily = avgBefore?.avg_sales || 0;

  // Ventas durante el evento
  const eventStart = event.start_date;
  const eventEnd = event.end_date || event.start_date;

  const actual = db.prepare(`
    SELECT SUM(s.total) as total_sales, COUNT(DISTINCT date(s.created_at)) as days
    FROM sales s WHERE s.status = 'completed'
      AND date(s.created_at) BETWEEN ? AND ?
  `).get(eventStart, eventEnd);

  const actualDays = actual?.days || 1;
  const actualDaily = (actual?.total_sales || 0) / actualDays;
  const deltaPct = expectedDaily > 0 ? ((actualDaily - expectedDaily) / expectedDaily) * 100 : 0;

  let impactLabel = 'neutral';
  if (deltaPct > 15) impactLabel = 'positive_high';
  else if (deltaPct > 5) impactLabel = 'positive_low';
  else if (deltaPct < -15) impactLabel = 'negative_high';
  else if (deltaPct < -5) impactLabel = 'negative_low';

  // Guardar medicion
  db.prepare(`INSERT INTO event_impacts (event_id, event_name, start_date, end_date, branch_id, expected_sales, actual_sales, delta_pct, impact_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    eventId, event.name, eventStart, eventEnd, event.branch_id || 0,
    expectedDaily, actualDaily, deltaPct, impactLabel
  );

  // Actualizar impacto medido en el evento
  db.prepare('UPDATE events SET impact_measured = ? WHERE id = ?').run(deltaPct, eventId);

  return { expectedDaily, actualDaily, deltaPct, impactLabel, impact_measured: deltaPct };
}

// ============================================================
// OBTENER FACTORES DE EVENTOS PARA PREDICCION
// ============================================================
function getEventFactorsForDate(date, branchId = 0) {
  const db = getDB();
  const events = db.prepare(`
    SELECT * FROM events WHERE start_date <= ? AND end_date >= ?
      AND (branch_id = ? OR branch_id = 0)
  `).all(date, date, branchId);

  let totalFactor = 1.0;
  const activeEvents = [];

  for (const ev of events) {
    // Buscar impacto historico
    const impact = db.prepare(`
      SELECT delta_pct FROM event_impacts WHERE event_name = ? ORDER BY created_at DESC LIMIT 1
    `).get(ev.name);

    let factor = 1.0;
    if (impact && impact.delta_pct !== null) {
      factor = 1 + (impact.delta_pct / 100);
    } else {
      // Impacto esperado por defecto
      const impactMap = { low: 1.05, medium: 1.12, high: 1.25 };
      factor = impactMap[ev.impact_expected] || 1.12;
    }

    totalFactor *= factor;
    activeEvents.push({ id: ev.id, name: ev.name, type: ev.type, factor, impact_expected: ev.impact_expected });
  }

  return { totalFactor, activeEvents };
}

// ============================================================
// CLIMA - STUB (reemplazar con API real)
// ============================================================
function fetchWeatherForDate(date, city) {
  // TODO: Integrar con API meteorologica real (ej. OpenWeatherMap)
  // Por ahora retorna datos simulados
  const db = getDB();
  const cached = db.prepare('SELECT * FROM weather_cache WHERE date = ? ORDER BY fetched_at DESC LIMIT 1').get(date);
  if (cached) return cached;

  // Simular datos
  const month = new Date(date + 'T12:00:00').getMonth();
  const isRainy = (month >= 5 && month <= 9); // Mayo-Septiembre lluvias
  const tempBase = isRainy ? 22 : 18;

  const weather = {
    date,
    temp_high: tempBase + Math.round(Math.random() * 8),
    temp_low: tempBase - Math.round(Math.random() * 6),
    temp_avg: tempBase + Math.round(Math.random() * 3 - 1),
    rain_mm: isRainy ? Math.round(Math.random() * 20) : Math.round(Math.random() * 3),
    condition_text: isRainy ? 'Lluvia ligera' : 'Despejado',
  };

  db.prepare(`INSERT OR REPLACE INTO weather_cache (branch_id, date, temp_high, temp_low, temp_avg, rain_mm, condition_text, source) VALUES (0, ?, ?, ?, ?, ?, ?, 'simulated')`).run(
    date, weather.temp_high, weather.temp_low, weather.temp_avg, weather.rain_mm, weather.condition_text
  );

  return weather;
}

function getWeatherImpactFactor(date) {
  const w = fetchWeatherForDate(date);
  let factor = 1.0;
  if (w.rain_mm > 10) factor = 0.85;
  else if (w.rain_mm > 5) factor = 0.92;
  if (w.temp_avg > 35) factor *= 0.90;
  else if (w.temp_avg < 5) factor *= 0.88;
  return factor;
}

// ============================================================
// FACTOR COMBINADO (eventos + clima)
// ============================================================
function getCombinedFactor(date, branchId = 0) {
  const eventFactor = getEventFactorsForDate(date, branchId);
  const weatherFactor = getWeatherImpactFactor(date);
  const combined = eventFactor.totalFactor * weatherFactor;
  return { combined, eventFactor: eventFactor.totalFactor, weatherFactor, activeEvents: eventFactor.activeEvents };
}

// ============================================================
// EVENTOS PROXIMOS (para UI)
// ============================================================
function getUpcomingEvents(days = 30, branchId = 0) {
  const db = getDB();
  const today = new Date().toISOString().split('T')[0];
  const future = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM events WHERE start_date >= ? AND start_date <= ?
      AND (branch_id = ? OR branch_id = 0)
    ORDER BY start_date ASC
  `).all(today, future, branchId);
}

module.exports = {
  syncPreloadedEvents,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  measureEventImpact,
  getEventFactorsForDate,
  getCombinedFactor,
  getUpcomingEvents,
  fetchWeatherForDate,
};
