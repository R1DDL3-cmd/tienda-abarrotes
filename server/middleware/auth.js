const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// El secreto se genera una sola vez por instalación (nunca un valor fijo en
// el código): un secreto constante permitiría forjar tokens de admin sin
// credenciales en CUALQUIER instalación del software, ya que el .asar
// empaquetado es trivialmente extraíble.
function loadSecret() {
  const configPath = path.join(__dirname, '..', '..', 'data', '.secret');
  try {
    const existing = fs.readFileSync(configPath, 'utf8').trim();
    if (existing) return existing;
  } catch (e) {}
  const secret = crypto.randomBytes(48).toString('hex');
  try {
    if (!fs.existsSync(path.dirname(configPath))) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
    }
    fs.writeFileSync(configPath, secret, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {}
  return secret;
}

const JWT_SECRET = process.env.JWT_SECRET || loadSecret();
const JWT_EXPIRES = '12h';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  req.user = decoded;
  next();
}

function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Acceso denegado - Se requiere rol de administrador' });
  }
}

function inventoryAdminMiddleware(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'inventory')) {
    next();
  } else {
    res.status(403).json({ error: 'Acceso denegado - Se requiere rol de administrador o inventario' });
  }
}

// Compras a proveedores: el dueño pidió explícitamente que los cajeros
// también puedan registrarlas, no solo el admin.
function purchasesMiddleware(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'cashier' || req.user.role === 'inventory')) {
    next();
  } else {
    res.status(403).json({ error: 'Acceso denegado' });
  }
}

module.exports = { generateToken, verifyToken, authMiddleware, adminMiddleware, inventoryAdminMiddleware, purchasesMiddleware, JWT_SECRET };
