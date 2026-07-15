const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let db = null;
let currentDBPath = null;
let SQL = null;

function computeDBPath() {
  if (process.env.ELECTRON_RUN === 'true') {
    const appDir = path.join(
      process.env.APPDATA || process.env.HOME || '.',
      'TiendaAbarrotes'
    );
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
    return path.join(appDir, 'tienda.db');
  }
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'tienda.db');
}

function saveDB() {
  if (db && currentDBPath) {
    const data = db.sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(currentDBPath, buffer);
  }
}

class Statement {
  constructor(dbWrapper, sql) {
    this.db = dbWrapper;
    this.sqlDb = dbWrapper.sqlDb;
    this.sql = sql;
  }

  run(...params) {
    try {
      if (params.length === 1 && Array.isArray(params[0])) {
        this.sqlDb.run(this.sql, params[0]);
      } else {
        this.sqlDb.run(this.sql, params);
      }
      const changes = this.sqlDb.getRowsModified();
      // Get last_insert_rowid BEFORE saveDB to avoid any state reset
      const lastIdStmt = this.sqlDb.prepare("SELECT last_insert_rowid() as id");
      let lastInsertRowid = 0;
      if (lastIdStmt.step()) {
        const row = lastIdStmt.getAsObject();
        lastInsertRowid = row.id || 0;
      }
      lastIdStmt.free();
      if (!this.db._inTransaction) saveDB();
      return { lastInsertRowid, changes };
    } catch (e) {
      throw e;
    }
  }

  get(...params) {
    try {
      const stmt = this.sqlDb.prepare(this.sql);
      if (params.length > 0) {
        const flatParams = Array.isArray(params[0]) ? params[0] : params;
        stmt.bind(flatParams);
      }
      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      throw e;
    }
  }

  all(...params) {
    try {
      const results = [];
      const stmt = this.sqlDb.prepare(this.sql);
      if (params.length > 0) {
        const flatParams = Array.isArray(params[0]) ? params[0] : params;
        stmt.bind(flatParams);
      }
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (e) {
      throw e;
    }
  }
}

class DatabaseWrapper {
  constructor(sqlDb) {
    this.sqlDb = sqlDb;
    this._inTransaction = false;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  run(sql, params = []) {
    try {
      this.sqlDb.run(sql, params);
      saveDB();
    } catch (e) {
      throw e;
    }
  }

  exec(sql) {
    this.sqlDb.exec(sql);
    saveDB();
  }

  pragma(str) {}

  close() {
    saveDB();
    if (this.sqlDb) this.sqlDb.close();
  }

  backup(destPath) {
    const data = this.sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(destPath, buffer);
  }

  transaction(fn) {
    const self = this;
    return function (...args) {
      try {
        self._inTransaction = true;
        self.sqlDb.run('BEGIN');
        const result = fn(...args);
        self.sqlDb.run('COMMIT');
        self._inTransaction = false;
        saveDB();
        return result;
      } catch (e) {
        self.sqlDb.run('ROLLBACK');
        self._inTransaction = false;
        throw e;
      }
    };
  }
}

async function initDatabase() {
  SQL = await initSqlJs();
  currentDBPath = computeDBPath();

  let fileExists = false;
  try {
    fileExists = fs.existsSync(currentDBPath) && fs.statSync(currentDBPath).size > 0;
  } catch (e) {
    fileExists = false;
  }

  let sqlDb;
  if (fileExists) {
    const fileBuffer = fs.readFileSync(currentDBPath);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  db = new DatabaseWrapper(sqlDb);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      category_id INTEGER,
      category_name TEXT,
      purchase_price REAL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      supplier TEXT,
      unit_type TEXT DEFAULT 'unit' CHECK(unit_type IN ('unit', 'kg', 'l')),
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      batch_code TEXT,
      quantity REAL DEFAULT 0,
      expiry_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      balance REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      discount REAL DEFAULT 0,
      payment_method TEXT NOT NULL,
      payment_details TEXT,
      customer_id INTEGER,
      customer_name TEXT,
      status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled', 'returned')),
      cancel_reason TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      barcode TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL DEFAULT 0,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      sale_id INTEGER,
      amount REAL NOT NULL,
      payment_method TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('in', 'out', 'adjustment')),
      quantity REAL NOT NULL,
      stock_before REAL DEFAULT 0,
      stock_after REAL DEFAULT 0,
      reference_type TEXT,
      reference_id INTEGER,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      payment_method TEXT DEFAULT 'cash',
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_register (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      opening_amount REAL DEFAULT 0,
      closing_amount REAL,
      expected_amount REAL,
      difference REAL,
      total_sales REAL DEFAULT 0,
      total_expenses REAL DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      opened_by INTEGER,
      closed_by INTEGER,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS product_waste (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_type TEXT,
      reason TEXT NOT NULL,
      waste_type TEXT NOT NULL CHECK(waste_type IN ('waste', 'return_to_supplier')),
      total_loss REAL NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id INTEGER NOT NULL,
      session_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('opening', 'closing', 'sale', 'expense', 'waste', 'return', 'payment', 'withdrawal', 'cancel_withdrawal')),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id INTEGER,
      reference_type TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT,
      opening_amount REAL DEFAULT 0,
      closing_amount REAL DEFAULT 0,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('holiday', 'sports', 'weather', 'local', 'promotion', 'other')),
      start_date DATE NOT NULL,
      end_date DATE,
      branch_id INTEGER DEFAULT 0,
      impact_expected TEXT DEFAULT 'medium' CHECK(impact_expected IN ('low', 'medium', 'high')),
      impact_measured REAL,
      is_recurring INTEGER DEFAULT 0,
      recurring_rule TEXT,
      source TEXT DEFAULT 'manual',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_impacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      event_name TEXT,
      start_date DATE NOT NULL,
      end_date DATE,
      branch_id INTEGER DEFAULT 0,
      expected_sales REAL,
      actual_sales REAL,
      delta_pct REAL,
      impact_label TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weather_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER DEFAULT 0,
      date DATE NOT NULL,
      temp_high REAL,
      temp_low REAL,
      temp_avg REAL,
      rain_mm REAL,
      condition_text TEXT,
      source TEXT DEFAULT 'api',
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(branch_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_events_date ON events(start_date);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_weather_date ON weather_cache(date);

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      invoice_number TEXT,
      subtotal REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'cancelled')),
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prediction_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      predicted_qty REAL NOT NULL,
      actual_qty REAL NOT NULL,
      forecast_date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
    CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses(created_at);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
  `);

  try { db.exec('ALTER TABLE products ADD COLUMN unit_type TEXT DEFAULT \'unit\' CHECK(unit_type IN (\'unit\', \'kg\', \'l\'))'); } catch (e) {}
  try { db.exec('ALTER TABLE products DROP COLUMN expiry_date'); } catch (e) {}
  try { db.exec('ALTER TABLE cash_movements ADD COLUMN session_id INTEGER'); } catch (e) {}
  // Add 'withdrawal' and 'cancel_withdrawal' to cash_movements CHECK by recreating table
  try {
    db.exec('ALTER TABLE cash_movements RENAME TO cm_old');
    db.exec(`CREATE TABLE cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id INTEGER NOT NULL,
      session_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('opening', 'closing', 'sale', 'expense', 'waste', 'return', 'payment', 'withdrawal', 'cancel_withdrawal')),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id INTEGER,
      reference_type TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    try {
      db.exec('INSERT INTO cash_movements SELECT * FROM cm_old');
    } catch (_) {
      db.exec('INSERT INTO cash_movements (id, cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at) SELECT id, cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at FROM cm_old');
    }
    db.exec('DROP TABLE cm_old');
  } catch (e) {}
  // Remove CHECK constraint from users table to allow 'inventory' role
  try {
    db.exec('ALTER TABLE users RENAME TO users_old');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'cashier\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    db.exec('INSERT INTO users SELECT * FROM users_old');
    db.exec('DROP TABLE users_old');
  } catch (e) {}

  saveDB();
  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

function reloadDB() {
  if (!SQL || !currentDBPath) throw new Error('Database not initialized');
  if (!fs.existsSync(currentDBPath)) throw new Error('Database file not found on disk');
  
  if (db && db.sqlDb) {
    try { db.sqlDb.close(); } catch (e) {}
  }
  
  db = null;
  
  const fileBuffer = fs.readFileSync(currentDBPath);
  const sqlDb = new SQL.Database(fileBuffer);
  
  db = new DatabaseWrapper(sqlDb);
  
  try { db.exec('ALTER TABLE cash_movements ADD COLUMN session_id INTEGER'); } catch (e) {}
  
  try {
    db.exec('ALTER TABLE cash_movements RENAME TO cm_old');
    db.exec(`CREATE TABLE cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cash_register_id INTEGER NOT NULL,
      session_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('opening', 'closing', 'sale', 'expense', 'waste', 'return', 'payment', 'withdrawal', 'cancel_withdrawal')),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      reference_id INTEGER,
      reference_type TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    try { db.exec('INSERT INTO cash_movements SELECT * FROM cm_old'); } catch (_) { db.exec('INSERT INTO cash_movements (id, cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at) SELECT id, cash_register_id, type, description, amount, reference_id, reference_type, created_by, created_by_name, created_at FROM cm_old'); }
    db.exec('DROP TABLE cm_old');
  } catch (e) {}
  
  try {
    db.exec('ALTER TABLE users RENAME TO users_old');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'cashier\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    db.exec('INSERT INTO users SELECT * FROM users_old');
    db.exec('DROP TABLE users_old');
  } catch (e) {}
  
  try { db.exec('ALTER TABLE products ADD COLUMN unit_type TEXT DEFAULT \'unit\' CHECK(unit_type IN (\'unit\', \'kg\', \'l\'))'); } catch (e) {}
  try { db.exec('ALTER TABLE products DROP COLUMN expiry_date'); } catch (e) {}
  
  saveDB();
}

module.exports = { initDatabase, getDB, getDBPath: () => currentDBPath, reloadDB };
