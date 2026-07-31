const express = require('express');
const { getDB } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { openDrawer } = require('../services/hardware');
const { listarImpresoras, listarPuertosSerie, imprimir } = require('../services/printer');
const { construirTicket, cargarPlantilla } = require('../services/ticket/buildTicket');
const { renderTexto } = require('../services/ticket/renderText');
const { renderEscpos } = require('../services/ticket/renderEscpos');
const { textoPrueba, escposPrueba } = require('../services/ticket/testPrint');
const { getPrinterConfig, getStoreConfig } = require('./settings');

const router = express.Router();

router.post('/open-drawer', authMiddleware, async (req, res) => {
  try {
    const result = await openDrawer();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Impresoras y puertos disponibles, para la pantalla de Configuración.
router.get('/printers', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [impresoras, puertos] = await Promise.all([listarImpresoras(), Promise.resolve(listarPuertosSerie())]);
    res.json({ impresoras, puertos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Prueba de impresión de INSTALACIÓN: imprime reglas de 32/48/64 columnas y
// una línea con acentos. Con eso se decide el ancho y la página de códigos
// sin necesidad de conocer el modelo de la impresora.
router.post('/test-print', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const cfg = { ...getPrinterConfig(db), ...(req.body || {}) };
    const plantilla = cargarPlantilla({ recargar: true });
    plantilla.escpos = { ...plantilla.escpos, codepage: cfg.codepage, translit: cfg.translit };

    const texto = textoPrueba(plantilla);
    if (cfg.modo === 'html') {
      // Sin impresora ESC/POS configurada: se devuelve el texto para que el
      // frontend lo muestre/imprima por el camino de siempre.
      return res.json({ ok: true, via: 'html', texto });
    }
    const resultado = await imprimir(escposPrueba(plantilla), cfg);
    res.json({ ...resultado, texto });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Vista previa en texto de un ticket ya guardado. El frontend NUNCA arma el
// layout: lo pide aquí, para que la previa sea idéntica carácter por carácter
// a lo que sale impreso (criterio de aceptación 8).
router.get('/ticket/:saleId/preview', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.saleId);
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);

    const cfg = getPrinterConfig(db);
    const ancho = parseInt(req.query.ancho, 10) || cfg.columnas;
    const plantilla = cargarPlantilla();
    const ticket = construirTicket(sale, getStoreConfig(db), plantilla);
    const copia = req.query.copia === '1';
    res.json({
      ancho,
      modo: cfg.modo,
      texto: renderTexto(ticket, ancho, plantilla, { copia }),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Imprime un ticket ya guardado. Si no hay impresora ESC/POS configurada o
// falla, se responde via:'html' y el frontend cae al camino de siempre —
// nadie se queda sin ticket por un problema de hardware.
router.post('/ticket/:saleId/print', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.saleId);
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);

    const cfg = getPrinterConfig(db);
    const plantilla = cargarPlantilla();
    plantilla.escpos = { ...plantilla.escpos, codepage: cfg.codepage, translit: cfg.translit };
    const ticket = construirTicket(sale, getStoreConfig(db), plantilla);
    const copia = !!(req.body && req.body.copia);
    const texto = renderTexto(ticket, cfg.columnas, plantilla, { copia });

    if (cfg.modo === 'html') return res.json({ ok: true, via: 'html', texto });

    const bytes = renderEscpos(ticket, cfg.columnas, plantilla, { copia });
    const resultado = await imprimir(bytes, cfg);
    // Falló el hardware: se responde con el texto para el respaldo HTML.
    if (!resultado.ok) return res.json({ ...resultado, via: 'html', texto });
    res.json({ ...resultado, texto });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
