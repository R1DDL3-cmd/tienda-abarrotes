#!/usr/bin/env node
/**
 * DEJAR LOS USUARIOS DE FÁBRICA
 *
 * Devuelve las dos cuentas con las que sale el sistema recién instalado:
 *
 *     admin  / admin123    (dueño)
 *     cajero / cajero123   (cajero)
 *
 * Si existen, les repone la contraseña; si no, las crea. Es el botón de
 * emergencia para cuando una tienda perdió sus accesos: al entrar con estas
 * claves, el sistema mismo obliga a cambiarlas (login devuelve
 * must_change_password para estos dos pares usuario/contraseña).
 *
 * NO borra ningún otro usuario. Las ventas y los cortes guardan el id del
 * cajero que las hizo: borrar cuentas dejaría el historial sin dueño. Si
 * sobran cuentas, se quitan después desde Configuración → Usuarios.
 *
 * Uso, con la APLICACIÓN CERRADA:
 *
 *     node scripts/usuarios-por-defecto.js
 *     node scripts/usuarios-por-defecto.js --db "C:\ruta\tienda.db"
 *
 * Para poner una contraseña propia en vez de las de fábrica, usa
 * scripts/restablecer-acceso.js.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

const POR_DEFECTO = [
  { username: 'admin', password: 'admin123', name: 'Dueño', role: 'admin' },
  { username: 'cajero', password: 'cajero123', name: 'Cajero', role: 'cashier' },
];

function rutaPorDefecto() {
  const base = process.env.APPDATA || process.env.HOME || '.';
  return path.join(base, 'TiendaAbarrotes', 'tienda.db');
}

function appAbierta(puerto = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: puerto, host: '127.0.0.1' });
    socket.setTimeout(700);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function salir(mensaje) {
  console.error('\n  ' + mensaje + '\n');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const iDb = args.indexOf('--db');
  const rutaDB = iDb >= 0 ? args[iDb + 1] : rutaPorDefecto();
  const forzar = args.includes('--forzar');

  if (!rutaDB || !fs.existsSync(rutaDB)) {
    salir(`No encontré la base en:\n  ${rutaDB}\n\n  Indícala con --db "ruta\\a\\tienda.db"`);
  }

  if (!forzar && await appAbierta()) {
    salir('La aplicación está abierta (responde en el puerto 3000).\n' +
          '  Ciérrala primero: mientras corre, la base vive en memoria y\n' +
          '  cualquier cambio hecho por fuera se pierde al siguiente guardado.');
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(rutaDB));

  // Respaldo con fecha antes de tocar nada.
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const respaldo = path.join(path.dirname(rutaDB), `respaldo-antes-de-usuarios-${sello}.db`);
  fs.copyFileSync(rutaDB, respaldo);

  const existentes = [];
  const st = db.prepare('SELECT id, username FROM users');
  while (st.step()) existentes.push(st.getAsObject());
  st.free();

  console.log(`\n  Base: ${rutaDB}`);
  console.log(`  Respaldo: ${respaldo}\n`);

  for (const u of POR_DEFECTO) {
    const hash = bcrypt.hashSync(u.password, 10);
    const ya = existentes.find(e => e.username === u.username);
    if (ya) {
      db.run('UPDATE users SET password = ?, role = ? WHERE id = ?', [hash, u.role, ya.id]);
      console.log(`  ${u.username.padEnd(8)} restablecido  ->  ${u.password}`);
    } else {
      db.run('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
        [u.username, hash, u.name, u.role]);
      console.log(`  ${u.username.padEnd(8)} creado        ->  ${u.password}`);
    }
  }

  const otros = existentes.filter(e => !POR_DEFECTO.some(u => u.username === e.username));
  if (otros.length) {
    console.log(`\n  Se conservaron sin cambios ${otros.length} cuenta(s) más: ${otros.map(o => o.username).join(', ')}`);
  }

  fs.writeFileSync(rutaDB, Buffer.from(db.export()));
  db.close();

  console.log('\n  Listo. Abre el sistema y entra con admin / admin123.');
  console.log('  El propio sistema va a pedir cambiar la contraseña al entrar.\n');
}

main().catch(e => salir('Error: ' + e.message));
