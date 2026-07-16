const API_BASE = '/api';

let authToken = localStorage.getItem('authToken');

export function setToken(token) {
  authToken = token;
  if (token) localStorage.setItem('authToken', token);
  else localStorage.removeItem('authToken');
}

export function getToken() {
  return authToken;
}

// --- Checkpoint 1 de modo offline: catálogo de solo lectura ---
// La tablet accede por IP de LAN sobre HTTP plano (no localhost, no HTTPS),
// así que un Service Worker no es una opción — los navegadores solo permiten
// Service Workers en "contextos seguros" (verificado en vivo: funciona en
// localhost, se bloquea en http://192.168.x.x). Este es un caché manual en
// localStorage: cada fetch exitoso del catálogo guarda una copia; si el
// fetch falla (sin red), se cae a esa copia y se filtra en el cliente.
// Cubre "se cae el WiFi a medio turno" — NO cubre abrir la app desde cero
// sin conexión (eso sí requeriría Service Worker + HTTPS).
const OFFLINE_PRODUCTS_KEY = 'offline_catalog_products';
const OFFLINE_CUSTOMERS_KEY = 'offline_catalog_customers';

function saveOfflineSnapshot(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch (e) {}
}

function loadOfflineSnapshot(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function request(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (res.status === 401) {
    if (endpoint === '/auth/login') {
      const err = await res.json().catch(() => ({ error: 'Credenciales incorrectas' }));
      throw new Error(err.error || 'Credenciales incorrectas');
    }
    setToken(null);
    window.location.hash = '#/login';
    throw new Error('Sesión expirada');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error de conexión' }));
    throw new Error(err.error || 'Error del servidor');
  }

  return res.json();
}

export const auth = {
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) => request('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  listUsers: () => request('/auth/users'),
  createUser: (data) => request('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/auth/users/${id}`, { method: 'DELETE' }),
};

export const products = {
  list: (params) => request(`/products?${new URLSearchParams(params)}`),
  all: async () => {
    try {
      const res = await request('/products/all');
      saveOfflineSnapshot(OFFLINE_PRODUCTS_KEY, res.products);
      return res;
    } catch (e) {
      const snap = loadOfflineSnapshot(OFFLINE_PRODUCTS_KEY);
      if (snap) return { products: snap.data, _offline: true, _cachedAt: snap.ts };
      throw e;
    }
  },
  search: async (q) => {
    try {
      return await request(`/products?search=${encodeURIComponent(q)}&limit=50`);
    } catch (e) {
      const snap = loadOfflineSnapshot(OFFLINE_PRODUCTS_KEY);
      if (snap) {
        const term = q.toLowerCase();
        const products = snap.data.filter(p =>
          p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.includes(q))
        ).slice(0, 50);
        return { products, total: products.length, _offline: true, _cachedAt: snap.ts };
      }
      throw e;
    }
  },
  getByBarcode: async (barcode) => {
    try {
      return await request(`/products/barcode/${encodeURIComponent(barcode)}`);
    } catch (e) {
      const snap = loadOfflineSnapshot(OFFLINE_PRODUCTS_KEY);
      const found = snap?.data.find(p => p.barcode === barcode);
      if (found) return { ...found, _offline: true, _cachedAt: snap.ts };
      throw e;
    }
  },
  lowStock: () => request('/products/low-stock'),
  expiring: () => request('/products/expiring'),
  create: (data) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  categories: () => request('/products/categories'),
  createCategory: (name) => request('/products/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  updateCategory: (id, name) => request(`/products/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteCategory: (id) => request(`/products/categories/${id}`, { method: 'DELETE' }),
  kardex: (productId, params) => request(`/products/kardex/${productId}?${new URLSearchParams(params)}`),
  batches: (productId) => request(`/products/batches/${productId}`),
  addBatch: (productId, data) => request(`/products/batches/${productId}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBatch: (batchId) => request(`/products/batches/${batchId}`, { method: 'DELETE' }),
  barcodes: (productId) => request(`/products/${productId}/barcodes`),
  addBarcode: (productId, barcode) => request(`/products/${productId}/barcodes`, { method: 'POST', body: JSON.stringify({ barcode }) }),
  deleteBarcode: (barcodeId) => request(`/products/barcodes/${barcodeId}`, { method: 'DELETE' }),
  obsolete: (days) => request(`/products/obsolete${days ? `?days=${days}` : ''}`),
  getObsoleteSettings: () => request('/products/obsolete/settings'),
  setObsoleteSettings: (days) => request('/products/obsolete/settings', { method: 'PUT', body: JSON.stringify({ days }) }),
};

export const sales = {
  create: (data) => request('/sales', { method: 'POST', body: JSON.stringify(data) }),
  list: (params) => request(`/sales?${new URLSearchParams(params)}`),
  today: () => request('/sales/today'),
  get: (id) => request(`/sales/${id}`),
  cancel: (id, reason) => request(`/sales/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  ticket: (id) => request(`/sales/ticket/${id}`),
  exportDetailed: (params) => request(`/sales/export?${new URLSearchParams(params)}`),
};

export const customers = {
  list: async (search) => {
    try {
      const res = await request(`/customers?${search ? `search=${encodeURIComponent(search)}` : ''}`);
      if (!search) saveOfflineSnapshot(OFFLINE_CUSTOMERS_KEY, res.customers);
      return res;
    } catch (e) {
      const snap = loadOfflineSnapshot(OFFLINE_CUSTOMERS_KEY);
      if (snap) {
        const term = (search || '').toLowerCase();
        const customers = term
          ? snap.data.filter(c => c.name.toLowerCase().includes(term) || (c.phone && c.phone.includes(search)))
          : snap.data;
        return { customers, _offline: true, _cachedAt: snap.ts };
      }
      throw e;
    }
  },
  get: (id) => request(`/customers/${id}`),
  history: (id) => request(`/customers/${id}/history`),
  create: (data) => request('/customers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  addPayment: (id, data) => request(`/customers/${id}/payment`, { method: 'POST', body: JSON.stringify(data) }),
};

export const accounting = {
  dashboard: () => request('/accounting/dashboard'),
  cashRegister: () => request('/accounting/cash-register'),
  updateCashRegister: (data) => request('/accounting/cash-register', { method: 'PUT', body: JSON.stringify(data) }),
  history: (params) => request(`/accounting/history?${new URLSearchParams(params)}`),
  expenses: (params) => request(`/accounting/expenses?${new URLSearchParams(params)}`),
  addExpense: (data) => request('/accounting/expenses', { method: 'POST', body: JSON.stringify(data) }),
  deleteExpense: (id) => request(`/accounting/expenses/${id}`, { method: 'DELETE' }),
  topProducts: (params) => request(`/accounting/top-products?${new URLSearchParams(params)}`),
  profit: (params) => request(`/accounting/profit?${new URLSearchParams(params)}`),
  cashMovements: (params) => request(`/accounting/cash-movements?${new URLSearchParams(params)}`),
  addWaste: (data) => request('/accounting/product-waste', { method: 'POST', body: JSON.stringify(data) }),
  listWaste: (params) => request(`/accounting/product-waste?${new URLSearchParams(params)}`),
  mySession: () => request('/accounting/my-session'),
  openSession: (data) => request('/accounting/sessions', { method: 'POST', body: JSON.stringify(data) }),
  closeSession: (id, data) => request(`/accounting/sessions/${id}/close`, { method: 'PUT', body: JSON.stringify(data) }),
  predictions: () => request('/accounting/predictions'),
  predictionsByProduct: () => request('/accounting/predictions/products'),
  predictionsByCategory: () => request('/accounting/predictions/categories'),
  productPrediction: (id) => request(`/accounting/predictions/${id}`),
  recommendation: (productId) => request(`/accounting/recommendation/${productId}`),
  risk: (filter) => request(`/accounting/risk?filter=${filter || 'all'}`),
  feedback: (data) => request('/accounting/predictions/feedback', { method: 'POST', body: JSON.stringify(data) }),
  health: () => request('/accounting/predictions/health'),
};

export const events = {
  list: (params) => request(`/events?${new URLSearchParams(params)}`),
  get: (id) => request(`/events/${id}`),
  create: (data) => request('/events', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/events/${id}`, { method: 'DELETE' }),
  sync: (year) => request('/events/sync', { method: 'POST', body: JSON.stringify({ year }) }),
  measure: (id) => request(`/events/${id}/measure`, { method: 'POST' }),
  factors: (date, branchId) => request(`/events/factors/${date}?branch_id=${branchId || 0}`),
  upcoming: (days, branchId) => request(`/events/upcoming/${days || 30}?branch_id=${branchId || 0}`),
};

export const backup = {
  now: (destination) => request('/backup/now', { method: 'POST', body: JSON.stringify({ destination }) }),
  list: () => request('/backup/list'),
  restore: (filename) => request('/backup/restore', { method: 'POST', body: JSON.stringify({ filename }) }),
  exportDB: async () => {
    const token = authToken;
    const res = await fetch(`${API_BASE}/backup/export`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error('Error al exportar base de datos');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tienda_export_${new Date().toISOString().split('T')[0]}.db`;
    a.click();
    URL.revokeObjectURL(url);
  },
  importDB: async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const result = await request('/backup/import', {
            method: 'POST',
            body: JSON.stringify({ fileBase64: base64 })
          });
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsDataURL(file);
    });
  }
};

export const hardware = {
  openDrawer: () => request('/hardware/open-drawer', { method: 'POST' }),
};

export const withdrawals = {
  list: () => request('/accounting/withdrawals'),
  create: (data) => request('/accounting/withdrawals', { method: 'POST', body: JSON.stringify(data) }),
  cancel: (id) => request(`/accounting/withdrawals/${id}/cancel`, { method: 'PUT' }),
};

export const network = {
  info: () => request('/network-info'),
};

export const suppliers = {
  list: (search) => request(`/suppliers?${search ? `search=${encodeURIComponent(search)}` : ''}`),
  all: () => request('/suppliers/all'),
  get: (id) => request(`/suppliers/${id}`),
  create: (data) => request('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/suppliers/${id}`, { method: 'DELETE' }),
  purchases: (id) => request(`/suppliers/${id}/purchases`),
  syncFromProducts: () => request('/suppliers/sync-from-products', { method: 'POST' }),
  suggestedOrder: (id) => request(`/suppliers/${id}/suggested-order`),
};

export const purchases = {
  list: (params) => request(`/purchases?${new URLSearchParams(params || {})}`),
  get: (id) => request(`/purchases/${id}`),
  create: (data) => request('/purchases', { method: 'POST', body: JSON.stringify(data) }),
  receive: (id, items) => request(`/purchases/${id}/receive`, { method: 'PUT', body: JSON.stringify({ items }) }),
  cancel: (id) => request(`/purchases/${id}`, { method: 'DELETE' }),
};

export const settings = {
  getStore: () => request('/settings/store'),
  updateStore: (data) => request('/settings/store', { method: 'PUT', body: JSON.stringify(data) }),
};
