const express = require('express');
const router = express.Router();
const { syncPreloadedEvents, listEvents, getEvent, createEvent, updateEvent, deleteEvent, measureEventImpact, getCombinedFactor, getUpcomingEvents } = require('../services/events');
const { verifyToken } = require('../middleware/auth');

// ============================================================
// MIDDLEWARE: autenticacion simple
// ============================================================
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Token invalido o expirado' });
  req.user = decoded;
  next();
}

// ============================================================
// Sincronizar eventos precargados del ano actual y siguiente
// ============================================================
router.post('/sync', auth, (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    syncPreloadedEvents(year);
    syncPreloadedEvents(year + 1);
    res.json({ success: true, message: `Eventos precargados sincronizados para ${year}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Listar eventos
// ============================================================
router.get('/', auth, (req, res) => {
  try {
    const events = listEvents(req.query);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Obtener un evento
// ============================================================
router.get('/upcoming/:days', auth, (req, res) => {
  try {
    const branchId = parseInt(req.query.branch_id) || 0;
    const events = getUpcomingEvents(parseInt(req.params.days) || 30, branchId);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/factors/:date', auth, (req, res) => {
  try {
    const branchId = parseInt(req.query.branch_id) || 0;
    const result = getCombinedFactor(req.params.date, branchId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, (req, res) => {
  try {
    const event = getEvent(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Crear evento manual
// ============================================================
router.post('/', auth, (req, res) => {
  try {
    const event = createEvent(req.body);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Actualizar evento
// ============================================================
router.put('/:id', auth, (req, res) => {
  try {
    const event = updateEvent(req.params.id, req.body);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Eliminar evento
// ============================================================
router.delete('/:id', auth, (req, res) => {
  try {
    deleteEvent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Medir impacto de un evento (post-evento)
// ============================================================
router.post('/:id/measure', auth, (req, res) => {
  try {
    const result = measureEventImpact(req.params.id);
    if (!result) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
