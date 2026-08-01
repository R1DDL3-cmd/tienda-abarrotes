#!/usr/bin/env node
/**
 * RESTABLECER EL ACCESO DE UNA TIENDA
 *
 * Para cuando un cliente perdió la contraseña del admin y ya no puede entrar
 * al sistema. Dentro de la aplicación no hay salida: cambiar la contraseña
 * propia exige saber la actual, y cambiar la de otro usuario exige una sesión
 * de administrador. La única vía es escribir directamente en la base.
 *
 * Se ejecuta CON LA APLICACIÓN CERRADA. La base vive en memoria mientras la
 * app corre y se vuelca completa al disco al guardar: cualquier cambio hecho
 * por fuera con la app abierta se perdería al siguiente volcado.
 *
 * Uso:
 *   node scripts/restablecer-acceso.js --lista
 *   node scripts/restablecer-acceso.js --usuario admin --clave "Temporal2026"
 *   node scripts/restablecer-acceso.js --nuevo-admin --usuario dueno --clave "Temporal2026" --nombre "Dueño"
 *
 * Opciones:
 *   --db <ruta>    Base a modificar. Por defecto la de la instalación local
 *                  (%APPDATA%\TiendaAbarrotes\tienda.db). Para atender a un
 *                  cliente: que te mande su tienda.db, lo corriges aquí y se
 *                  lo regresas.
 *   --forzar       Continúa aunque parezca que la aplicación está abierta.
 *
 * Siempre deja un respaldo con fecha junto a la base antes de escribir.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

// ---------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function rutaPorDefecto() {
  const base = process.env.APPDATA || process.env.HOME || '.';
  return path.join(base, 'TiendaAbarrotes', 'tienda.db');
}

// ¿La aplicación está corriendo? Si su servidor responde, sí.
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

// ---------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rutaDB = args.db || rutaPorDefecto();

  if (!fs.existsSync(rutaDB)) {
    salir(`No encontré la base en:\n  ${rutaDB}\n\n  Indícala con --db "ruta\\a\\tienda.db"`);
  }

  const soloLista = !!args.lista;

  if (!soloLista && !args.forzar && await appAbierta()) {
    salir('La aplicación parece estar abierta (responde en el puerto 3000).\n' +
          '  Ciérrala antes de continuar: si no, tus cambios se pierden cuando\n' +
          '  la app vuelva a guardar la base.');
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(rutaDB));

  const consultar = (sql, params = []) => {
    const st = db.prepare(sql);
    st.bind(params);
    const filas = [];
    while (st.step()) filas.push(st.getAsObject());
    st.free();
    return filas;
  };

  const usuarios = consultar('SELECT id, username, name, role, created_at FROM users ORDER BY id');

  console.log(`\n  Base: ${rutaDB}`);
  console.log(`  Usuarios registrados: ${usuarios.length}\n`);
  for (const u of usuarios) {
    console.log(`    #${u.id}  ${u.username.padEnd(14)} ${String(u.role).padEnd(10)} ${u.name}`);
  }
  console.log('');

  if (soloLista) {
    console.log('  Para restablecer una contraseña:');
    console.log('    node scripts/restablecer-acceso.js --usuario <usuario> --clave "<temporal>"\n');
    return;
  }

  const clave = args.clave;
  if (!clave || clave === true) {
    salir('Falta la contraseña temporal: --clave "Temporal2026"');
  }
  if (String(clave).length < 6) {
    salir('Usa una contraseña temporal de al menos 6 caracteres.');
  }

  // Respaldo con fecha ANTES de tocar nada.
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const respaldo = path.join(path.dirname(rutaDB), `respaldo-antes-de-restablecer-${sello}.db`);
  fs.copyFileSync(rutaDB, respaldo);
  console.log(`  Respaldo: ${respaldo}`);

  const hash = bcrypt.hashSync(String(clave), 10);

  if (args['nuevo-admin']) {
    // Crea un administrador de emergencia sin tocar a los usuarios existentes.
    // Sirve cuando no quedó NINGÚN admin al que devolverle el acceso.
    const usuario = args.usuario;
    if (!usuario || usuario === true) salir('Falta el nombre de usuario: --usuario <usuario>');
    if (usuarios.some(u => u.username === usuario)) {
      salir(`Ya existe el usuario "${usuario}". Para cambiarle la contraseña usa:\n` +
            `  node scripts/restablecer-acceso.js --usuario ${usuario} --clave "..."`);
    }
    db.run('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
      [usuario, hash, args.nombre && args.nombre !== true ? args.nombre : 'Dueño', 'admin']);
    console.log(`\n  Administrador creado: ${usuario}`);
  } else {
    const usuario = args.usuario;
    if (!usuario || usuario === true) salir('Falta el nombre de usuario: --usuario <usuario>');
    const existente = usuarios.find(u => u.username === usuario);
    if (!existente) {
      salir(`No existe el usuario "${usuario}".\n` +
            `  Usa --lista para ver los que hay, o --nuevo-admin para crear uno.`);
    }
    db.run('UPDATE users SET password = ? WHERE id = ?', [hash, existente.id]);
    console.log(`\n  Contraseña restablecida para: ${existente.username} (${existente.role})`);
  }

  fs.writeFileSync(rutaDB, Buffer.from(db.export()));
  db.close();

  console.log('\n  Listo. Entra con la contraseña temporal y cámbiala de inmediato desde');
  console.log('  Configuración → Contraseña.\n');
  console.log('  Si algo salió mal, restaura el respaldo copiándolo sobre tienda.db.\n');
}

main().catch(e => salir('Error: ' + e.message));
