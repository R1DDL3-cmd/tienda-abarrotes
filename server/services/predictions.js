const { getDB } = require('../db');

// ============================================================
// Nexo Systems — Motor de Prediccion de Ventas v1.0 (MVP)
// Disenado para tiendas de abarrotes independientes:
//   - Cientos de tickets/dia, muchos SKUs con ventas esporadicas
//   - Hardware Windows de gama baja
//   - Sin dependencias externas de ML (matematica pura en JS)
// ============================================================

// --- Utileria matematica ---
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function avg(arr) { return arr.length === 0 ? 0 : sum(arr) / arr.length; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// ============================================================
// 1. CLASIFICACION DE DEMANDA POR SKU
// ============================================================
// Cada producto se clasifica para elegir el metodo de prediccion adecuado:
//   - REGULAR: vende casi todos los dias (>60% de dias con ventas >0)
//   - INTERMITTENT: muchos dias en cero (10-60% de dias con ventas)
//   - ERRATIC: ventas muy variables, coeficiente de variacion alto
//   - SEASONAL: patron estacional detectable
//   - NEW: menos de 30 dias de historial -> usa categoria como proxy
//   - INACTIVE: sin ventas en >90 dias
// ============================================================
function classifyDemand(dailySales, productAgeDays) {
  if (productAgeDays < 30) return 'NEW';

  const totalDays = dailySales.length;
  const positiveDays = dailySales.filter(v => v > 0).length;
  const ratio = totalDays > 0 ? positiveDays / totalDays : 0;

  // Revisar si hay ventas recientes
  const recentSales = dailySales.slice(-90).filter(v => v > 0).length;
  if (recentSales === 0 && dailySales.length > 90) return 'INACTIVE';

  // Coeficiente de variacion (solo dias positivos)
  const posValues = dailySales.filter(v => v > 0);
  const cv = posValues.length > 1 ? stddev(posValues) / avg(posValues) : 999;

  if (ratio >= 0.6) {
    // Posiblemente estacional si la variacion entre semanas es alta
    if (dailySales.length >= 60) {
      const weekly = [];
      for (let i = 0; i < dailySales.length; i += 7) {
        weekly.push(sum(dailySales.slice(i, i + 7)));
      }
      const weeklyCv = weekly.length > 1 ? stddev(weekly) / avg(weekly) : 0;
      if (weeklyCv > 0.5 && cv > 0.8) return 'SEASONAL';
    }
    return 'REGULAR';
  }

  if (ratio >= 0.1) return 'INTERMITTENT';
  return 'ERRATIC';
}

// ============================================================
// 2. MODELOS DE PREDICCION
// ============================================================

// 2a. Simple Moving Average (SMA) — baseline obligatorio
function sma(history, window = 7) {
  if (history.length < window) return avg(history);
  return avg(history.slice(-window));
}

// 2b. Exponential Smoothing (SES) — para demanda regular
function ses(history, alpha = 0.3) {
  if (history.length === 0) return 0;
  let forecast = history[0];
  for (let i = 1; i < history.length; i++) {
    forecast = alpha * history[i] + (1 - alpha) * forecast;
  }
  return forecast;
}

// 2c. Croston method — para demanda intermitente
// Separa la serie en intervalos entre demandas (>0) y tamanos de demanda
function croston(history) {
  const intervals = [];
  const sizes = [];
  let lastPos = -1;
  for (let i = 0; i < history.length; i++) {
    if (history[i] > 0) {
      if (lastPos >= 0) intervals.push(i - lastPos);
      sizes.push(history[i]);
      lastPos = i;
    }
  }
  // Si no hay suficientes datos, fallback a SES
  if (sizes.length < 3) return ses(history, 0.2);

  const avgInterval = avg(intervals);
  const avgSize = avg(sizes);
  // Probabilidad de demanda en un dia = 1 / intervalo promedio
  const prob = 1 / avgInterval;
  // Demanda esperada por dia = probabilidad * tamano promedio
  return prob * avgSize;
}

// 2d. Holt-Winters (simple) — para demanda estacional (periodo semanal)
function holtWinters(history, period = 7, alpha = 0.3, beta = 0.1, gamma = 0.1) {
  if (history.length < period * 2) return ses(history, alpha); // fallback

  const n = history.length;
  // Inicializar nivel, tendencia y estacionalidad
  let level = avg(history.slice(0, period));
  let trend = (avg(history.slice(period, period * 2)) - level) / period;
  const seasonal = [];
  for (let i = 0; i < period; i++) {
    seasonal.push(history[i] / level);
  }

  // Suavizar
  for (let i = 0; i < n; i++) {
    const lastLevel = level;
    const seasonalIdx = i % period;
    level = alpha * (history[i] / seasonal[seasonalIdx]) + (1 - alpha) * (level + trend);
    trend = beta * (level - lastLevel) + (1 - beta) * trend;
    seasonal[seasonalIdx] = gamma * (history[i] / level) + (1 - gamma) * seasonal[seasonalIdx];
  }

  // Predecir 1 periodo adelante
  return (level + trend) * seasonal[n % period];
}

// ============================================================
// 3. PREDICTOR PRINCIPAL POR PRODUCTO
// ============================================================
function predictProduct(productId, db) {
  // Obtener historial de ventas diarias (ultimos 365 dias)
  const sales = db.prepare(`
    SELECT date(created_at) as date, SUM(quantity) as qty
    FROM sale_items si JOIN sales s ON si.sale_id = s.id
    WHERE si.product_id = ? AND s.status = 'completed'
      AND s.created_at >= datetime('now', '-365 days')
    GROUP BY date(created_at) ORDER BY date ASC
  `).all(productId);

  // Obtener informacion del producto
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return null;

  const now = new Date();
  const createdDate = new Date(product.created_at || now);
  const productAgeDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

  // Construir serie diaria (fill missing dates with 0)
  const dailySales = [];
  const salesMap = {};
  for (const s of sales) salesMap[s.date] = s.qty;
  for (let i = 365; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    dailySales.push(salesMap[key] || 0);
  }

  // Ultimos 90 dias para prediccion
  const recent90 = dailySales.slice(-90);
  const last30 = dailySales.slice(-30);

  // Clasificar demanda
  const demandType = classifyDemand(dailySales, productAgeDays);

  // Seleccionar metodo y generar prediccion
  let dailyForecast;
  switch (demandType) {
    case 'REGULAR':
      dailyForecast = ses(recent90, 0.3);
      break;
    case 'SEASONAL':
      dailyForecast = holtWinters(recent90, 7);
      break;
    case 'INTERMITTENT':
      dailyForecast = croston(recent90);
      break;
    case 'NEW': {
      // Producto nuevo: usar promedio de la categoria como proxy
      const catSales = db.prepare(`
        SELECT AVG(si.quantity) as avg_qty
        FROM sale_items si JOIN sales s ON si.sale_id = s.id
        WHERE si.product_id IN (SELECT id FROM products WHERE category_id = ? AND id != ?)
          AND s.status = 'completed' AND s.created_at >= datetime('now', '-90 days')
      `).get(product.category_id, productId);
      dailyForecast = catSales?.avg_qty || 0;
      break;
    }
    default:
      dailyForecast = sma(recent90, 14);
  }

  // Calcular baseline (SMA) para comparacion
  const baseline = sma(recent90, 14);

  // Calcular error historico (MAE) del modelo vs real en ultimos 30 dias
  const modelErrors = [];
  for (let i = 0; i < last30.length; i++) {
    // Reconstruir prediccion para cada punto
    let pred;
    const hist = dailySales.slice(-90 - (30 - i), - (30 - i) || undefined);
    if (hist.length > 0) {
      switch (demandType) {
        case 'REGULAR': pred = ses(hist, 0.3); break;
        case 'SEASONAL': pred = holtWinters(hist, 7); break;
        case 'INTERMITTENT': pred = croston(hist); break;
        default: pred = sma(hist, 14);
      }
    } else {
      pred = 0;
    }
    modelErrors.push(Math.abs(pred - last30[i]));
  }

  const mae = avg(modelErrors);
  const baselineErrors = last30.map((v, idx) => Math.abs(sma(dailySales.slice(-60 - (30 - idx), -(30 - idx) || undefined), 14) - v));
  const baselineMae = avg(baselineErrors);

  // Intervalo de confianza del 80%
  const errorStddev = stddev(modelErrors);
  const ciLower = Math.max(0, dailyForecast - 1.28 * errorStddev);
  const ciUpper = dailyForecast + 1.28 * errorStddev;

  // Prediccion mensual y semanal
  const weeklyForecast = dailyForecast * 7;
  const monthlyForecast = dailyForecast * 30;

  // Recomendacion de compra
  const stock = product.stock || 0;
  const minStock = product.min_stock || 0;
  const daysUntilStockout = dailyForecast > 0 ? stock / dailyForecast : 999;
  const reorderPoint = Math.ceil(weeklyForecast * 1.5); // 1.5 semanas de cobertura
  const safetyStock = Math.ceil(1.28 * errorStddev * Math.sqrt(7)); // 80% servicio, 1 semana lead time
  const suggestedOrder = dailyForecast > 0
    ? Math.max(0, Math.ceil(reorderPoint + safetyStock - stock))
    : 0;

  return {
    product_id: product.id,
    product_name: product.name,
    category_name: product.category_name || '',
    barcode: product.barcode,
    demand_type: demandType,
    daily_forecast: Math.round(dailyForecast * 100) / 100,
    weekly_forecast: Math.round(weeklyForecast * 100) / 100,
    monthly_forecast: Math.round(monthlyForecast * 100) / 100,
    ci_lower: Math.round(ciLower * 100) / 100,
    ci_upper: Math.round(ciUpper * 100) / 100,
    mae: Math.round(mae * 100) / 100,
    baseline_mae: Math.round(baselineMae * 100) / 100,
    baseline_daily: Math.round(baseline * 100) / 100,
    current_stock: stock,
    min_stock: minStock,
    days_until_stockout: Math.round(daysUntilStockout * 10) / 10,
    reorder_point: reorderPoint,
    safety_stock: safetyStock,
    suggested_order: suggestedOrder,
    product_age_days: productAgeDays,
    history_days: dailySales.filter(v => v > 0).length
  };
}

// ============================================================
// 4. PREDICCION COMPLETA (todos los productos activos)
// ============================================================
// predictProduct() recalcula el modelo ~30 veces por producto (backtesting de
// error), de forma sincrona sobre el mismo hilo que atiende el POS. Con un
// catalogo de varios cientos de SKUs, correr esto en cada llamada a
// /accounting/predictions, /risk y /predictions/health (que antes lo hacian
// cada uno por separado) podia congelar las cajas/tablets varios segundos.
// Se cachea el resultado por catalogo completo: es un tablero de compras, no
// un dato que necesite ser exacto al segundo.
const PREDICTIONS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
let _predictionsCache = { data: null, ts: 0 };

function invalidatePredictionsCache() {
  _predictionsCache = { data: null, ts: 0 };
}

function predictAll(db, { forceRefresh = false } = {}) {
  if (!forceRefresh && _predictionsCache.data && (Date.now() - _predictionsCache.ts) < PREDICTIONS_CACHE_TTL_MS) {
    return _predictionsCache.data;
  }
  const products = db.prepare("SELECT id FROM products WHERE active = 1").all();
  const results = [];
  for (const p of products) {
    try {
      const pred = predictProduct(p.id, db);
      if (pred) results.push(pred);
    } catch (e) {
      console.error(`Error predicting product ${p.id}: ${e.message}`);
    }
  }
  _predictionsCache = { data: results, ts: Date.now() };
  return results;
}

// ============================================================
// 5. PREDICCION POR CATEGORIA (agregada)
// ============================================================
function predictByCategory(db) {
  const predictions = predictAll(db);
  const productsMeta = db.prepare("SELECT id, category_name FROM products WHERE active = 1").all();
  const categoryById = {};
  for (const p of productsMeta) categoryById[p.id] = p.category_name || 'General';

  const catMap = {};
  for (const pred of predictions) {
    const cat = categoryById[pred.product_id] || 'General';
    if (!catMap[cat]) catMap[cat] = { category: cat, product_count: 0, daily_forecast: 0, monthly_forecast: 0, current_stock: 0, suggested_order: 0 };
    catMap[cat].product_count++;
    catMap[cat].daily_forecast += pred.daily_forecast;
    catMap[cat].monthly_forecast += pred.monthly_forecast;
    catMap[cat].current_stock += pred.current_stock;
    catMap[cat].suggested_order += pred.suggested_order;
  }
  return Object.values(catMap).sort((a, b) => b.monthly_forecast - a.monthly_forecast);
}

// ============================================================
// 6. RESUMEN EJECUTIVO
// ============================================================
function getExecutiveSummary(db) {
  const predictions = predictAll(db);
  const totalDaily = sum(predictions.map(p => p.daily_forecast));
  const totalMonthly = sum(predictions.map(p => p.monthly_forecast));
  const totalStock = sum(predictions.map(p => p.current_stock));
  const totalSuggestedOrder = sum(predictions.map(p => p.suggested_order));
  const stockoutRisk = predictions.filter(p => p.days_until_stockout < 7).length;
  const overstockRisk = predictions.filter(p => p.current_stock > p.monthly_forecast * 2 && p.monthly_forecast > 0).length;
  const topReorder = predictions
    .filter(p => p.suggested_order > 0)
    .sort((a, b) => b.suggested_order - a.suggested_order)
    .slice(0, 20);
  const byDemandType = {};
  for (const p of predictions) {
    byDemandType[p.demand_type] = (byDemandType[p.demand_type] || 0) + 1;
  }

  return {
    generated_at: new Date().toISOString(),
    total_products: predictions.length,
    total_daily_forecast: Math.round(totalDaily * 100) / 100,
    total_weekly_forecast: Math.round(totalDaily * 7 * 100) / 100,
    total_monthly_forecast: Math.round(totalMonthly * 100) / 100,
    total_current_stock: Math.round(totalStock * 100) / 100,
    total_suggested_order: Math.round(totalSuggestedOrder * 100) / 100,
    stockout_risk_count: stockoutRisk,
    overstock_risk_count: overstockRisk,
    top_reorder: topReorder.map(p => ({
      product_id: p.product_id,
      product_name: p.product_name,
      daily_forecast: p.daily_forecast,
      current_stock: p.current_stock,
      days_until_stockout: p.days_until_stockout,
      suggested_order: p.suggested_order
    })),
    demand_distribution: byDemandType
  };
}

module.exports = { predictProduct, predictAll, predictByCategory, getExecutiveSummary, invalidatePredictionsCache };
