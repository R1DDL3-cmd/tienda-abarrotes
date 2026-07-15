const jwt = require('jsonwebtoken');

const JWT_SECRET = 'tienda-abarrotes-secret-key-2024';
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

module.exports = { generateToken, verifyToken, authMiddleware, adminMiddleware, inventoryAdminMiddleware, JWT_SECRET };
