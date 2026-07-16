// Regresion: db.transaction() debe dejar los cambios escritos en disco al
// terminar el COMMIT, incluso si no ocurre ninguna otra escritura despues.
// El writer y el reader corren en procesos node separados (no solo funciones
// separadas) para que el reader lea el .db real desde disco en vez de
// reusar el estado en memoria del writer.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mode = process.argv[2];

if (!mode) {
  const testAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-tx-test-'));
  const env = { ...process.env, ELECTRON_RUN: 'true', APPDATA: testAppData };

  const writer = spawnSync(process.execPath, [__filename, 'writer'], { env, stdio: 'inherit' });
  if (writer.status !== 0) {
    console.error('FALLO: el writer no pudo insertar la fila de prueba.');
    fs.rmSync(testAppData, { recursive: true, force: true });
    process.exit(1);
  }

  const reader = spawnSync(process.execPath, [__filename, 'reader'], { env, stdio: 'inherit' });
  fs.rmSync(testAppData, { recursive: true, force: true });
  process.exit(reader.status === 0 ? 0 : 1);
} else if (mode === 'writer') {
  (async () => {
    const { initDatabase, getDB } = require('./db');
    await initDatabase();
    const db = getDB();

    const insertCategory = db.transaction((name) => {
      const stmt = db.prepare('INSERT INTO categories (name) VALUES (?)');
      return stmt.run(name);
    });
    const result = insertCategory('CATEGORIA_TEST_TX');
    console.log('[writer] insertado dentro de transaccion, id:', result.lastInsertRowid);

    // Salida inmediata simulando un cierre/crash justo despues del COMMIT,
    // sin ninguna otra escritura no transaccional posterior.
    process.exit(0);
  })();
} else if (mode === 'reader') {
  (async () => {
    const { initDatabase, getDB } = require('./db');
    await initDatabase();
    const db = getDB();
    const row = db.prepare('SELECT * FROM categories WHERE name = ?').get('CATEGORIA_TEST_TX');

    if (row) {
      console.log('[reader] OK: la fila de la transaccion SI persistio en disco:', JSON.stringify(row));
      process.exit(0);
    } else {
      console.error('[reader] FALLO: la fila de la transaccion NO se encontro en disco (bug reproducido).');
      process.exit(1);
    }
  })();
} else {
  console.error('Modo desconocido:', mode);
  process.exit(1);
}
