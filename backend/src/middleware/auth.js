const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET || 'maiver-dev-secret-change-in-prod';

function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, SECRET(), { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET());
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' });
  }
  try {
    req.auth = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function adminOnly(req, res, next) {
  if (req.auth?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

function tenantOnly(req, res, next) {
  if (!req.auth?.tenantId) {
    return res.status(403).json({ error: 'Acesso restrito a usuários' });
  }
  next();
}

module.exports = { signToken, verifyToken, authMiddleware, adminOnly, tenantOnly };
