const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');
const { generateToken, authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const loginAttempts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;

function rateLimit(ip) {
  const now = Date.now();
  // Poda de entradas viejas: el mapa crecía sin límite (una entrada por IP
  // que alguna vez intentó login, para siempre).
  if (loginAttempts.size > 500) {
    for (const [key, entry] of loginAttempts) {
      if (now - entry.start > RATE_WINDOW_MS) loginAttempts.delete(key);
    }
  }
  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, { count: 1, start: now });
    return true;
  }
  const entry = loginAttempts.get(ip);
  if (now - entry.start > RATE_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, start: now });
    return true;
  }
  entry.count++;
  if (entry.count > 10) return false;
  return true;
}

router.post('/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Intente de nuevo en 15 minutos.' });
  }
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  // Login exitoso: no debe seguir contando contra el límite de intentos.
  loginAttempts.delete(ip);

  // Las contraseñas de fábrica están documentadas en el README (cualquiera en
  // el WiFi de la tienda puede probarlas): el frontend obliga a cambiarlas en
  // el primer inicio de sesión cuando este flag viene activo.
  const usingDefaultPassword =
    (user.username === 'admin' && password === 'admin123') ||
    (user.username === 'cajero' && password === 'cajero123');

  const token = generateToken(user);
  res.json({
    token,
    must_change_password: usingDefaultPassword,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

router.get('/users', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY name ASC').all();
  res.json({ users });
});

router.post('/users', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Usuario, contraseña y nombre requeridos' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: 'El nombre de usuario ya existe' });
  }
  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run(username, hashed, name, role || 'cashier');
  const user = db.prepare('SELECT id, username, name, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

router.put('/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const { username, password, name, role } = req.body;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (username && username !== existing.username) {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.params.id);
    if (dup) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
  }
  // Borrar al último admin ya estaba bloqueado, pero cambiarle el rol no:
  // degradarlo dejaba el sistema sin ningún administrador (sin forma de
  // gestionar usuarios, respaldos ni configuración).
  if (role && role !== 'admin' && existing.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
    if (adminCount.count <= 1) {
      return res.status(400).json({ error: 'No puedes quitarle el rol de administrador al último admin' });
    }
  }
  const updates = [];
  const params = [];
  if (username) { updates.push('username = ?'); params.push(username); }
  if (name) { updates.push('name = ?'); params.push(name); }
  if (role) { updates.push('role = ?'); params.push(role); }
  if (password) { updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10)); }
  if (updates.length > 0) {
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  const user = db.prepare('SELECT id, username, name, role, created_at FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

router.delete('/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
    if (adminCount.count <= 1) {
      return res.status(400).json({ error: 'No puedes eliminar al último administrador' });
    }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.put('/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
  res.json({ success: true });
});

module.exports = router;
