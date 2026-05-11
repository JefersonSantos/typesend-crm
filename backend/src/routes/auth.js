const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { one, tx } = require('../db/database');
const { signToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

/* ── Admin login ─────────────────────────────────────────────────────────── */
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const admin = await one('SELECT * FROM admin_users WHERE email = $1', [email]);
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = signToken({ sub: admin.id, email: admin.email, name: admin.name, role: 'admin' }, '8h');
    res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name, role: 'admin' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Tenant user login ───────────────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const user = await one('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const tenant = await one('SELECT id, name, status, credit_balance FROM tenants WHERE id = $1', [user.tenant_id]);
    if (tenant.status === 'blocked')   return res.status(403).json({ error: 'Conta bloqueada. Entre em contato com o suporte.' });
    if (tenant.status === 'suspended') return res.status(403).json({ error: 'Conta suspensa por inadimplência.' });

    const token = signToken({
      sub: user.id, email: user.email, name: user.name,
      role: user.role, tenantId: user.tenant_id,
    });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Register (creates tenant + owner user) ──────────────────────────────── */
router.post('/register', async (req, res) => {
  try {
    const { tenantName, email, password, name } = req.body;
    if (!tenantName || !email || !password || !name)
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });

    const exists = await one('SELECT id FROM users WHERE email = $1', [email]);
    if (exists) return res.status(409).json({ error: 'Email já cadastrado' });

    const hash     = await bcrypt.hash(password, 12);
    const tenantId = uuidv4();
    const userId   = uuidv4();

    await tx(async (client) => {
      await client.query(
        'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
        [tenantId, tenantName, email]
      );
      await client.query(
        'INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, tenantId, email, hash, name, 'owner']
      );
    });

    const token = signToken({ sub: userId, email, name, role: 'owner', tenantId });
    res.status(201).json({
      token,
      user: { id: userId, email, name, role: 'owner', tenant: { id: tenantId, name: tenantName } },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Me ──────────────────────────────────────────────────────────────────── */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    if (req.auth.role === 'admin') {
      const admin = await one('SELECT id, email, name FROM admin_users WHERE id = $1', [req.auth.sub]);
      return res.json({ ...admin, role: 'admin' });
    }
    const [user, tenant] = await Promise.all([
      one('SELECT id, email, name, role FROM users WHERE id = $1', [req.auth.sub]),
      one('SELECT id, name, status, credit_balance FROM tenants WHERE id = $1', [req.auth.tenantId]),
    ]);
    res.json({ ...user, tenant });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
