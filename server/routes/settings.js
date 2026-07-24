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

module.exports = router;
