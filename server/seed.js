const bcrypt = require('bcryptjs');
const { getDB } = require('./db');

function importProductsFromExcel(db) {
  try {
    const XLSX = require('xlsx');
    const path = require('path');
    const fs = require('fs');

    let excelPath;
    if (process.resourcesPath) {
      excelPath = path.join(process.resourcesPath, 'productos.xlsx');
    } else {
      excelPath = path.join(__dirname, '..', 'resources', 'productos.xlsx');
    }

    if (!fs.existsSync(excelPath)) return;

    const wb = XLSX.readFile(excelPath);
    const ws = wb.Sheets['Articulos'];
    if (!ws) return;

    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const products = data.slice(1).filter(r => r[0] || r[1]);

    const categoryNames = [...new Set(products.map(r => r[2]).filter(Boolean))];
    const categoryMap = {};
    for (const name of categoryNames) {
      let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
      if (!cat) {
        const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
        cat = { id: result.lastInsertRowid };
      }
      categoryMap[name] = cat.id;
    }

    function normalizeUnit(u) {
      if (!u) return 'unit';
      const val = u.trim().toLowerCase();
      if (val === 'kls.' || val === 'kls' || val === 'kg') return 'kg';
      if (val === 'lt.' || val === 'lt' || val === 'ml.' || val === 'ml') return 'l';
      return 'unit';
    }

    const insert = db.prepare(`INSERT INTO products (barcode, name, category_id, category_name, purchase_price, sale_price, stock, min_stock, supplier, unit_type, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    let count = 0;
    for (const row of products) {
      const barcode = (row[0] || '').toString().trim();
      const name = (row[1] || '').trim();
      if (!barcode && !name) continue;
      const categoryName = (row[2] || '').trim();
      const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
      if (existing) continue;
      insert.run(
        barcode, name,
        categoryName ? categoryMap[categoryName] || null : null,
        categoryName,
        parseFloat(row[7]) || 0,
        parseFloat(row[4]) || 0,
        parseInt(row[22]) || 0,
        parseInt(row[10]) || 0,
        (row[17] || '').trim() || null,
        normalizeUnit(row[9]),
        parseInt(row[16]) === 1 ? 0 : 1
      );
      count++;
    }
    if (count > 0) console.log(`Importados ${count} productos del archivo productos.xlsx`);
  } catch (e) {
    console.error('Error al importar productos:', e.message);
  }
}

function seedDatabase() {
  const db = getDB();

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const cashierPassword = bcrypt.hashSync('cajero123', 10);

    db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run('admin', adminPassword, 'Dueño', 'admin');
    db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run('cajero', cashierPassword, 'Cajero', 'cashier');

    console.log('Usuarios creados por defecto:');
    console.log('  admin / admin123');
    console.log('  cajero / cajero123');
  }

  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (catCount.count === 0) {
    const categories = ['Abarrotes', 'Lácteos', 'Panadería', 'Bebidas', 'Snacks', 'Limpieza', 'Higiene', 'Carnicería', 'Frutas y Verduras', 'Congelados'];
    const insert = db.prepare('INSERT INTO categories (name) VALUES (?)');
    for (const cat of categories) insert.run(cat);
  }

  const prodCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (prodCount.count === 0) {
    importProductsFromExcel(db);
  }

  const today = new Date().toISOString().split('T')[0];
  const existingRegister = db.prepare('SELECT id FROM cash_register WHERE date = ?').get(today);
  if (!existingRegister) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    db.prepare(
      'INSERT INTO cash_register (date, opening_amount, status, opened_by, opened_at) VALUES (?, 0, ?, ?, datetime("now"))'
    ).run(today, 'open', admin ? admin.id : 1);
  }
}

module.exports = { seedDatabase };