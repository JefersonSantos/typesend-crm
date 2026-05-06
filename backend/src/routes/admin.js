const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { getSetting } = require('../db/database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

/* ── Dashboard ───────────────────────────────────────────────────────────── */
router.get('/dashboard', (req, res) => {
  const stats = {
    tenants:             db.prepare("SELECT COUNT(*) as n FROM tenants").get().n,
    tenants_active:      db.prepare("SELECT COUNT(*) as n FROM tenants WHERE status='active'").get().n,
    tenants_blocked:     db.prepare("SELECT COUNT(*) as n FROM tenants WHERE status='blocked'").get().n,
    total_messages:      db.prepare("SELECT COUNT(*) as n FROM messages").get().n,
    total_campaigns:     db.prepare("SELECT COUNT(*) as n FROM campaigns").get().n,
    total_revenue:       db.prepare("SELECT ROUND(SUM(amount),4) as n FROM credit_transactions WHERE type='topup'").get().n || 0,
    total_credits_used:  db.prepare("SELECT ROUND(ABS(SUM(amount)),4) as n FROM credit_transactions WHERE type='usage'").get().n || 0,
  };

  const recentTenants = db.prepare(
    'SELECT id, name, email, status, credit_balance, created_at FROM tenants ORDER BY created_at DESC LIMIT 5'
  ).all();

  const msgPerDay = db.prepare(`
    SELECT DATE(sent_at) as day, COUNT(*) as count
    FROM messages WHERE sent_at >= datetime('now', '-7 days')
    GROUP BY day ORDER BY day ASC
  `).all();

  res.json({ stats, recentTenants, msgPerDay });
});

/* ── Tenants list ────────────────────────────────────────────────────────── */
router.get('/tenants', (req, res) => {
  const { search } = req.query;
  let q = 'SELECT t.*, (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count FROM tenants t';
  const params = [];
  if (search) {
    q += ' WHERE t.name LIKE ? OR t.email LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  q += ' ORDER BY t.created_at DESC';
  res.json(db.prepare(q).all(...params));
});

/* ── Create tenant ───────────────────────────────────────────────────────── */
router.post('/tenants', async (req, res) => {
  const { name, email, password, ownerName, initialCredits = 0 } = req.body;
  if (!name || !email || !password || !ownerName)
    return res.status(400).json({ error: 'Campos obrigatórios: name, email, password, ownerName' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email já cadastrado' });

  const hash     = await bcrypt.hash(password, 12);
  const tenantId = uuidv4();
  const userId   = uuidv4();

  db.exec('BEGIN');
  db.prepare(
    'INSERT INTO tenants (id, name, email, credit_balance) VALUES (?, ?, ?, ?)'
  ).run(tenantId, name, email, initialCredits);
  db.prepare(
    'INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, tenantId, email, hash, ownerName, 'owner');
  if (initialCredits > 0) {
    db.prepare(
      'INSERT INTO credit_transactions (id, tenant_id, amount, type, description) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), tenantId, initialCredits, 'manual_adjustment', 'Crédito inicial pelo admin');
  }
  db.exec('COMMIT');
  res.status(201).json(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId));
});

/* ── Update tenant (name, status, plan) ─────────────────────────────────── */
router.put('/tenants/:id', (req, res) => {
  const { name, status, plan } = req.body;
  const t = db.prepare('SELECT id FROM tenants WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
  db.prepare(
    'UPDATE tenants SET name = COALESCE(?, name), status = COALESCE(?, status), plan = COALESCE(?, plan) WHERE id = ?'
  ).run(name || null, status || null, plan || null, req.params.id);
  res.json(db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id));
});

/* ── Update tenant Twilio + AI config ───────────────────────────────────── */
router.put('/tenants/:id/twilio', (req, res) => {
  const { twilio_account_sid, twilio_auth_token, twilio_messaging_service_sid, webhook_url, anthropic_api_key } = req.body;
  const t = db.prepare('SELECT id FROM tenants WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });

  db.prepare(`
    UPDATE tenants SET
      twilio_account_sid           = COALESCE(?, twilio_account_sid),
      twilio_auth_token            = COALESCE(?, twilio_auth_token),
      twilio_messaging_service_sid = COALESCE(?, twilio_messaging_service_sid),
      webhook_url                  = COALESCE(?, webhook_url),
      anthropic_api_key            = COALESCE(?, anthropic_api_key)
    WHERE id = ?
  `).run(
    twilio_account_sid           || null,
    twilio_auth_token            || null,
    twilio_messaging_service_sid || null,
    webhook_url                  || null,
    anthropic_api_key            || null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  // Mask sensitive fields in response
  if (updated.twilio_auth_token)  updated.twilio_auth_token  = '••••••••';
  if (updated.anthropic_api_key)  updated.anthropic_api_key  = '••••••••';
  res.json(updated);
});

/* ── Clear tenant Twilio config (revert to global) ───────────────────────── */
router.delete('/tenants/:id/twilio', (req, res) => {
  const t = db.prepare('SELECT id FROM tenants WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
  db.prepare(`
    UPDATE tenants SET
      twilio_account_sid = NULL,
      twilio_auth_token = NULL,
      twilio_messaging_service_sid = NULL,
      webhook_url = NULL
    WHERE id = ?
  `).run(req.params.id);
  res.json({ ok: true });
});

/* ── Adjust credits ──────────────────────────────────────────────────────── */
router.post('/tenants/:id/credits', (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount obrigatório' });
  const t = db.prepare('SELECT id FROM tenants WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });

  db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(Number(amount), req.params.id);
  db.prepare(
    'INSERT INTO credit_transactions (id, tenant_id, amount, type, description) VALUES (?, ?, ?, ?, ?)'
  ).run(
    uuidv4(), req.params.id, Number(amount),
    Number(amount) > 0 ? 'manual_adjustment' : 'manual_debit',
    description || 'Ajuste manual pelo admin'
  );
  res.json({ balance: db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(req.params.id).credit_balance });
});

/* ── Tenant stats ────────────────────────────────────────────────────────── */
router.get('/tenants/:id/stats', (req, res) => {
  const id = req.params.id;
  const campaigns    = db.prepare("SELECT COUNT(*) as n FROM campaigns WHERE tenant_id = ?").get(id).n;
  const messages     = db.prepare("SELECT COUNT(*) as n FROM messages m JOIN campaigns c ON c.id = m.campaign_id WHERE c.tenant_id = ?").get(id).n;
  const spent        = db.prepare("SELECT ROUND(ABS(SUM(amount)),4) as n FROM credit_transactions WHERE tenant_id = ? AND type = 'usage'").get(id).n || 0;
  const transactions = db.prepare("SELECT * FROM credit_transactions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20").all(id);
  res.json({ campaigns, messages, spent, transactions });
});

/* ── Pricing ─────────────────────────────────────────────────────────────── */
router.get('/pricing', (req, res) => res.json(db.prepare('SELECT * FROM pricing').all()));

router.put('/pricing', (req, res) => {
  const items = req.body; // [{ resource_type, twilio_base_cost, markup, description }]
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Array esperado' });
  db.exec('BEGIN');
  for (const item of items) {
    db.prepare(`
      UPDATE pricing
      SET twilio_base_cost = COALESCE(?, twilio_base_cost),
          markup           = COALESCE(?, markup),
          description      = COALESCE(?, description),
          updated_at       = datetime('now')
      WHERE resource_type = ?
    `).run(
      item.twilio_base_cost != null ? Number(item.twilio_base_cost) : null,
      item.markup           != null ? Number(item.markup)           : null,
      item.description      || null,
      item.resource_type
    );
  }
  db.exec('COMMIT');
  res.json(db.prepare('SELECT * FROM pricing').all());
});

/* ── System Settings ─────────────────────────────────────────────────────── */
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM system_settings ORDER BY key ASC').all();
  // Mask sensitive values in response
  const masked = rows.map((r) => {
    const sensitive = r.key.includes('token') || r.key.includes('secret') || r.key.includes('key');
    return { ...r, value: sensitive && r.value ? '••••••••' : r.value };
  });
  res.json(masked);
});

// GET raw value for a single key (used by admin forms for pre-filling)
router.get('/settings/:key', (req, res) => {
  const row = db.prepare('SELECT * FROM system_settings WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'Setting não encontrado' });
  // Return real value for admin editing
  res.json(row);
});

router.put('/settings', (req, res) => {
  const updates = req.body; // { key: value, ... }
  if (typeof updates !== 'object' || Array.isArray(updates))
    return res.status(400).json({ error: 'Objeto { key: value } esperado' });

  db.exec('BEGIN');
  for (const [key, value] of Object.entries(updates)) {
    const exists = db.prepare('SELECT key FROM system_settings WHERE key = ?').get(key);
    if (exists) {
      db.prepare("UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = ?")
        .run(String(value ?? ''), key);
    }
    // Silently ignore unknown keys
  }
  db.exec('COMMIT');
  res.json({ ok: true });
});

/* ── Billing overview ────────────────────────────────────────────────────── */
router.get('/billing', (req, res) => {
  const { limit = 50, offset = 0, tenant_id } = req.query;
  let q = `SELECT ct.*, t.name as tenant_name FROM credit_transactions ct
           JOIN tenants t ON t.id = ct.tenant_id WHERE 1=1`;
  const params = [];
  if (tenant_id) { q += ' AND ct.tenant_id = ?'; params.push(tenant_id); }
  q += ' ORDER BY ct.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const total = db.prepare(
    `SELECT COUNT(*) as n FROM credit_transactions${tenant_id ? ' WHERE tenant_id = ?' : ''}`
  ).get(...(tenant_id ? [tenant_id] : []));
  res.json({ transactions: db.prepare(q).all(...params), total: total.n });
});

/* ── Logs (admin sees all) ───────────────────────────────────────────────── */
router.get('/logs', (req, res) => {
  const { level, category, limit = 100, offset = 0 } = req.query;
  let q = 'SELECT * FROM logs WHERE 1=1';
  const params = [];
  if (level)    { q += ' AND level = ?';    params.push(level); }
  if (category) { q += ' AND category = ?'; params.push(category); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  res.json(db.prepare(q).all(...params));
});

module.exports = router;
