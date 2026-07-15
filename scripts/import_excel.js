const XLSX = require('xlsx');
const path = require('path');
const { initDatabase, getDB } = require('../server/db');

async function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    console.error('Uso: node scripts/import_excel.js <ruta_al_excel>');
    process.exit(1);
  }

  console.log('Leyendo Excel:', excelPath);
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets['Articulos'];
  if (!ws) {
    console.error('No se encontró la hoja "Articulos"');
    process.exit(1);
  }

  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const products = data.slice(1).filter(r => r[0] || r[1]); // skip header

  await initDatabase();
  const db = getDB();

  // Build category map from LINEA column (index 2)
  const categoryNames = [...new Set(products.map(r => r[2]).filter(Boolean))];
  const categoryMap = {};
  for (const name of categoryNames) {
    let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (!cat) {
      const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
      cat = { id: result.lastInsertRowid };
      console.log('  Categoría creada:', name);
    }
    categoryMap[name] = cat.id;
  }

  // Normalize unit_type
  function normalizeUnit(u) {
    if (!u) return 'unit';
    const val = u.trim().toLowerCase();
    if (val === 'kls.' || val === 'kls' || val === 'kg') return 'kg';
    if (val === 'lt.' || val === 'lt' || val === 'ml.' || val === 'ml') return 'l';
    return 'unit';
  }

  let imported = 0;
  let updated = 0;

  for (const row of products) {
    const barcode = (row[0] || '').toString().trim();
    const name = (row[1] || '').trim();
    const categoryName = (row[2] || '').trim();
    const purchasePrice = parseFloat(row[7]) || 0;
    const salePrice = parseFloat(row[4]) || 0;
    const stock = parseInt(row[22]) || 0;
    const minStock = parseInt(row[10]) || 0;
    const supplier = (row[17] || '').trim();
    const unitType = normalizeUnit(row[9]);
    const blocked = parseInt(row[16]) || 0;
    const active = blocked === 1 ? 0 : 1;

    if (!barcode && !name) continue;

    const categoryId = categoryName ? categoryMap[categoryName] || null : null;

    const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
    if (existing) {
      db.prepare(`UPDATE products SET name=?, category_id=?, category_name=?, purchase_price=?, sale_price=?, stock=?, min_stock=?, supplier=?, unit_type=?, active=?, updated_at=datetime('now') WHERE id=?`)
        .run(name, categoryId, categoryName, purchasePrice, salePrice, stock, minStock, supplier || null, unitType, active, existing.id);
      updated++;
    } else {
      db.prepare(`INSERT INTO products (barcode, name, category_id, category_name, purchase_price, sale_price, stock, min_stock, supplier, unit_type, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(barcode, name, categoryId, categoryName, purchasePrice, salePrice, stock, minStock, supplier || null, unitType, active);
      imported++;
    }
  }

  console.log(`\nImportación completada:`);
  console.log(`  Productos insertados: ${imported}`);
  console.log(`  Productos actualizados: ${updated}`);
  console.log(`  Total: ${imported + updated}`);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
