const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { signToken, authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();

/* ── Admin login ─────────────────────────────────────────────────────────── */
router.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

  const admin = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = signToken({ sub: admin.id, email: admin.email, name: admin.name, role: 'admin' }, '8h');
  res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name, role: 'admin' } });
});

/* ── Tenant user login ───────────────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const tenant = db.prepare('SELECT id, name, status, credit_balance FROM tenants WHERE id = ?').get(user.tenant_id);
  if (tenant.status === 'blocked') return res.status(403).json({ error: 'Conta bloqueada. Entre em contato com o suporte.' });
  if (tenant.status === 'suspended') return res.status(403).json({ error: 'Conta suspensa por inadimplência.' });

  const token = signToken({
    sub: user.id, email: user.email, name: user.name,
    role: user.role, tenantId: user.tenant_id,
  });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant } });
});

/* ── Register (creates tenant + owner user) ──────────────────────────────── */
router.post('/register', async (req, res) => {
  const { tenantName, email, password, name } = req.body;
  if (!tenantName || !email || !password || !name) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email já cadastrado' });

  const hash = await bcrypt.hash(password, 12);
  const tenantId = uuidv4();
  const userId = uuidv4();

  db.exec('BEGIN');
  db.prepare('INSERT INTO tenants (id, name, email) VALUES (?, ?, ?)').run(tenantId, tenantName, email);
  db.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)').run(
    userId, tenantId, email, hash, name, 'owner'
  );
  db.exec('COMMIT');

  const token = signToken({ sub: userId, email, name, role: 'owner', tenantId });
  res.status(201).json({ token, user: { id: userId, email, name, role: 'owner', tenant: { id: tenantId, name: tenantName } } });
});

/* ── Me ──────────────────────────────────────────────────────────────────── */
router.get('/me', authMiddleware, (req, res) => {
  if (req.auth.role === 'admin') {
    const admin = db.prepare('SELECT id, email, name FROM admin_users WHERE id = ?').get(req.auth.sub);
    return res.json({ ...admin, role: 'admin' });
  }
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.auth.sub);
  const tenant = db.prepare('SELECT id, name, status, credit_balance FROM tenants WHERE id = ?').get(req.auth.tenantId);
  res.json({ ...user, tenant });
});

module.exports = router;
