const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const STORE_KEYS = ['store_name', 'store_address', 'store_phone', 'ticket_footer'];
const STORE_DEFAULTS = {
  store_name: 'Tienda de Abarrotes',
  store_address: '',
  store_phone: '',
  ticket_footer: '¡Gracias por su compra!'
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
    ticket_footer: byKey.ticket_footer ?? STORE_DEFAULTS.ticket_footer
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

module.exports = router;
