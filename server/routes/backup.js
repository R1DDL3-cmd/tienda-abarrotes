const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDB, getDBPath, reloadDB, cancelPendingSave } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

function getBackupDir() {
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  const backupDir = path.join(homeDir || '.', 'TiendaAbarrotesBackups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

router.post('/now', authMiddleware, adminMiddleware, (req, res) => {
  const { destination } = req.body;
  const db = getDB();
  const dbPath = getDBPath();

  try {
    db.backup(path.join(dbPath + '.backup'));
    const sourcePath = dbPath + '.backup';
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupName = `tienda_backup_${dateStr}.db`;

    let destDir;
    if (destination) {
      // Solo se permite elegir una subcarpeta dentro de la carpeta de respaldos del
      // usuario (evita que un token robado/forjado escriba archivos en rutas
      // arbitrarias del sistema).
      const baseDir = getBackupDir();
      const resolved = path.resolve(baseDir, destination);
      if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
        return res.status(400).json({ error: 'Destino de respaldo inválido' });
      }
      destDir = resolved;
    } else {
      destDir = getBackupDir();
    }

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, backupName);
    fs.copyFileSync(sourcePath, destPath);
    fs.unlinkSync(sourcePath);

    res.json({ success: true, path: destPath, filename: backupName });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear respaldo: ' + e.message });
  }
});

router.get('/list', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) return res.json({ backups: [] });

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('tienda_backup_') && f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(backupDir, f));
        return { name: f, size: stat.size, date: stat.mtime };
      })
      .sort((a, b) => b.date - a.date);

    res.json({ backups: files, dir: backupDir });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/restore', authMiddleware, adminMiddleware, (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'Nombre de archivo requerido' });

  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, path.basename(filename));

  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: 'Archivo de respaldo no encontrado' });
  }

  try {
    const fileBuffer = fs.readFileSync(backupPath);
    if (fileBuffer.length < 100 || fileBuffer.readUInt8(0) !== 0x53 || fileBuffer.readUInt8(1) !== 0x51 || fileBuffer.readUInt8(2) !== 0x4C || fileBuffer.readUInt8(3) !== 0x69) {
      return res.status(400).json({ error: 'El archivo no es una base de datos SQLite válida' });
    }

    const dbPath = getDBPath();
    const backupBeforePath = dbPath + '.pre_restore_backup';
    fs.copyFileSync(dbPath, backupBeforePath);
    // Descartar guardados en vuelo de la BD vieja: uno pendiente podía
    // disparar entre la copia y el reload y sobreescribir el archivo restaurado.
    cancelPendingSave();
    fs.copyFileSync(backupPath, dbPath);

    reloadDB();

    res.json({ success: true, message: 'Base de datos restaurada exitosamente.' });
  } catch (e) {
    res.status(500).json({ error: 'Error al restaurar: ' + e.message });
  }
});

router.get('/export', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const dbPath = getDBPath();
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Base de datos no encontrada' });
    }
    const dateStr = new Date().toISOString().split('T')[0];
    res.download(dbPath, `tienda_export_${dateStr}.db`);
  } catch (e) {
    res.status(500).json({ error: 'Error al exportar: ' + e.message });
  }
});

router.post('/import', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { fileBase64 } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'Archivo requerido' });

    const dbPath = getDBPath();
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'Archivo vacío' });
    if (buffer.length < 100 || buffer.readUInt8(0) !== 0x53 || buffer.readUInt8(1) !== 0x51 || buffer.readUInt8(2) !== 0x4C || buffer.readUInt8(3) !== 0x69) {
      return res.status(400).json({ error: 'El archivo no es una base de datos SQLite válida' });
    }

    const backupPath = dbPath + '.pre_import_backup';
    fs.copyFileSync(dbPath, backupPath);
    cancelPendingSave();
    fs.writeFileSync(dbPath, buffer);

    try {
      reloadDB();
    } catch (reloadErr) {
      // Restaurar el estado anterior automáticamente en vez de dejar la app con una BD rota.
      fs.copyFileSync(backupPath, dbPath);
      reloadDB();
      return res.status(400).json({ error: 'El archivo importado no es una base de datos válida. Se restauró el estado anterior. Detalle: ' + reloadErr.message });
    }

    res.json({ success: true, message: 'Base de datos importada exitosamente. La aplicación se reiniciará.' });
  } catch (e) {
    res.status(500).json({ error: 'Error al importar: ' + e.message });
  }
});

module.exports = { router, getBackupDir };
