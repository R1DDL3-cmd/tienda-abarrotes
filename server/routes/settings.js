const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const STORE_KEYS = ['store_name', 'store_address', 'store_phone', 'ticket_footer', 'store_logo'];
const STORE_DEFAULTS = {
  store_name: 'Tienda de Abarrotes',
  store_address: '',
  store_phone: '',
  ticket_footer: '¡Gracias por su compra!',
  store_logo: ''
};

router.get('/store', authMiddleware, (req, res) => {
  const db = getDB();
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${STORE_KEYS.map(() => '?').join(',')})`).all(...STORE_KEYS);
  const byKey = {};
  for (const r of rows) byKey[r.key] = r.value;
  res.json({
    store_name: byKey.store_name ?? STORE_DEFAULTS.store_name,
    store_address: byKey.store_address ?? STORE_DEFAULTS.store_address,
    store_phone: byKey.store_phone ?? STORE_DEFAULTS.store_phone,
    ticket_footer: byKey.ticket_footer ?? STORE_DEFAULTS.ticket_footer,
    store_logo: byKey.store_logo ?? STORE_DEFAULTS.store_logo
  });
});

router.put('/store', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const key of STORE_KEYS) {
    if (req.body[key] !== undefined) upsert.run(key, String(req.body[key] ?? ''));
  }
  res.json({ success: true });
});

// Colores de marca personalizables. Vacío = usar el default del tema
// claro/oscuro activo, no forzar ningún color. Incluye los colores de la
// barra de navegación superior (header_bg / header_text) para que la tienda
// pueda ponerle su color de marca a la barra.
const PALETTE_KEYS = [
  'palette_primary', 'palette_success', 'palette_danger', 'palette_warning',
  'palette_header_bg', 'palette_header_text', 'palette_accent'
];

router.get('/palette', authMiddleware, (req, res) => {
  const db = getDB();
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${PALETTE_KEYS.map(() => '?').join(',')})`).all(...PALETTE_KEYS);
  const byKey = {};
  for (const r of rows) byKey[r.key] = r.value;
  const out = {};
  for (const k of PALETTE_KEYS) out[k] = byKey[k] || '';
  res.json(out);
});

router.put('/palette', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const key of PALETTE_KEYS) {
    if (req.body[key] !== undefined) upsert.run(key, String(req.body[key] ?? ''));
  }
  res.json({ success: true });
});

// Configuración de la impresora de tickets. El ancho se guarda en COLUMNAS
// (no en mm) porque es lo que de verdad determina el layout; la pantalla de
// Configuración muestra la equivalencia en mm y ofrece una prueba impresa
// para averiguarlo sin tener que saber el modelo.
const PRINTER_KEYS = ['printer_columns', 'printer_mode', 'printer_name', 'printer_port', 'printer_codepage', 'printer_translit'];
const PRINTER_DEFAULTS = {
  printer_columns: '32',   // 58 mm, lo más común en tiendas chicas
  printer_mode: 'html',    // arranca en el comportamiento actual: nadie se queda sin ticket
  printer_name: '',
  printer_port: '',
  printer_codepage: '2',   // CP850
  printer_translit: '0',
};

router.get('/printer', authMiddleware, (req, res) => {
  const db = getDB();
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${PRINTER_KEYS.map(() => '?').join(',')})`).all(...PRINTER_KEYS);
  const byKey = {};
  for (const r of rows) byKey[r.key] = r.value;
  const out = {};
  for (const k of PRINTER_KEYS) out[k] = byKey[k] ?? PRINTER_DEFAULTS[k];
  res.json(out);
});

router.put('/printer', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const columnas = req.body.printer_columns;
  if (columnas !== undefined && !['32', '48', '64'].includes(String(columnas))) {
    return res.status(400).json({ error: 'Ancho inválido: usa 32, 48 o 64 columnas' });
  }
  const modo = req.body.printer_mode;
  if (modo !== undefined && !['html', 'auto', 'raw', 'serial'].includes(String(modo))) {
    return res.status(400).json({ error: 'Modo de impresión inválido' });
  }
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const key of PRINTER_KEYS) {
    if (req.body[key] !== undefined) upsert.run(key, String(req.body[key] ?? ''));
  }
  res.json({ success: true });
});

// Config lista para usar por el servicio de impresión (valores ya tipados).
function getPrinterConfig(db) {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${PRINTER_KEYS.map(() => '?').join(',')})`).all(...PRINTER_KEYS);
  const byKey = {};
  for (const r of rows) byKey[r.key] = r.value;
  return {
    columnas: parseInt(byKey.printer_columns ?? PRINTER_DEFAULTS.printer_columns, 10),
    modo: byKey.printer_mode ?? PRINTER_DEFAULTS.printer_mode,
    impresora: byKey.printer_name || '',
    puerto_serie: byKey.printer_port || '',
    codepage: parseInt(byKey.printer_codepage ?? PRINTER_DEFAULTS.printer_codepage, 10),
    translit: (byKey.printer_translit ?? '0') === '1',
  };
}

// Datos de la tienda para el encabezado del ticket.
function getStoreConfig(db) {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${STORE_KEYS.map(() => '?').join(',')})`).all(...STORE_KEYS);
  const byKey = {};
  for (const r of rows) byKey[r.key] = r.value;
  const out = {};
  for (const k of STORE_KEYS) out[k] = byKey[k] ?? STORE_DEFAULTS[k];
  return out;
}

module.exports = router;
module.exports.getPrinterConfig = getPrinterConfig;
module.exports.getStoreConfig = getStoreConfig;
