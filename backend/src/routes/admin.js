const express  = require('express');
const bcrypt   = require('bcryptjs');
const { randomUUID } = require('crypto');
const { one, all, run, tx, getSetting } = require('../db/database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/dashboard', async (req, res) => {
  try {
    const [
      tenants, tenantsActive, tenantsBlocked,
      totalMessages, totalCampaigns, totalInstances,
      revenue, creditsUsed,
      recentTenants, msgPerDay,
    ] = await Promise.all([
      one("SELECT COUNT(*) as n FROM tenants"),
      one("SELECT COUNT(*) as n FROM tenants WHERE status='active'"),
      one("SELECT COUNT(*) as n FROM tenants WHERE status='blocked'"),
      one("SELECT COUNT(*) as n FROM messages"),
      one("SELECT COUNT(*) as n FROM campaigns"),
      one("SELECT COUNT(*) as n FROM whatsapp_instances"),
      one("SELECT ROUND(SUM(amount)::numeric,4) as n FROM credit_transactions WHERE type='topup'"),
      one("SELECT ROUND(ABS(SUM(amount))::numeric,4) as n FROM credit_transactions WHERE type='usage'"),
      all("SELECT id, name, email, status, credit_balance, created_at FROM tenants ORDER BY created_at DESC LIMIT 5"),
      all(`SELECT DATE(sent_at) as day, COUNT(*) as count
           FROM messages WHERE sent_at >= NOW() - INTERVAL '7 days'
           GROUP BY day ORDER BY day ASC`),
    ]);

    const stats = {
      tenants:            parseInt(tenants.n),
      tenants_active:     parseInt(tenantsActive.n),
      tenants_blocked:    parseInt(tenantsBlocked.n),
      total_messages:     parseInt(totalMessages.n),
      total_campaigns:    parseInt(totalCampaigns.n),
      total_instances:    parseInt(totalInstances.n),
      total_revenue:      parseFloat(revenue.n) || 0,
      total_credits_used: parseFloat(creditsUsed.n) || 0,
    };

    res.json({ stats, recentTenants, msgPerDay });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   TENANTS
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/tenants', async (req, res) => {
  try {
    const { search } = req.query;
    let q = `SELECT t.*,
      (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count,
      (SELECT COUNT(*) FROM whatsapp_instances WHERE tenant_id = t.id) as instance_count
      FROM tenants t`;
    const params = [];
    if (search) {
      q += ' WHERE t.name ILIKE $1 OR t.email ILIKE $2';
      params.push(`%${search}%`, `%${search}%`);
    }
    q += ' ORDER BY t.created_at DESC';
    const tenants = await all(q, params);
    res.json(tenants.map(t => ({ ...t, anthropic_api_key: t.anthropic_api_key ? '••••••••' : null })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tenants', async (req, res) => {
  try {
    const { name, email, password, ownerName, initialCredits = 0 } = req.body;
    if (!name || !email || !password || !ownerName)
      return res.status(400).json({ error: 'Campos obrigatórios: name, email, password, ownerName' });

    const exists = await one('SELECT id FROM users WHERE email = $1', [email]);
    if (exists) return res.status(409).json({ error: 'Email já cadastrado' });

    const hash     = await bcrypt.hash(password, 12);
    const tenantId = randomUUID();
    const userId   = randomUUID();

    await tx(async (client) => {
      await client.query(
        'INSERT INTO tenants (id, name, email, credit_balance) VALUES ($1, $2, $3, $4)',
        [tenantId, name, email, initialCredits]
      );
      await client.query(
        'INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, tenantId, email, hash, ownerName, 'owner']
      );
      if (Number(initialCredits) > 0) {
        await client.query(
          'INSERT INTO credit_transactions (id, tenant_id, amount, type, description) VALUES ($1, $2, $3, $4, $5)',
          [randomUUID(), tenantId, Number(initialCredits), 'manual_adjustment', 'Crédito inicial pelo admin']
        );
      }
    });

    res.status(201).json(await one('SELECT * FROM tenants WHERE id = $1', [tenantId]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tenants/:id', async (req, res) => {
  try {
    const { name, status, plan } = req.body;
    const t = await one('SELECT id FROM tenants WHERE id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
    await run(
      'UPDATE tenants SET name = COALESCE($1, name), status = COALESCE($2, status), plan = COALESCE($3, plan) WHERE id = $4',
      [name || null, status || null, plan || null, req.params.id]
    );
    res.json(await one('SELECT * FROM tenants WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar chave Anthropic do tenant
router.put('/tenants/:id/ai', async (req, res) => {
  try {
    const { anthropic_api_key } = req.body;
    const t = await one('SELECT id FROM tenants WHERE id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
    await run('UPDATE tenants SET anthropic_api_key = $1 WHERE id = $2', [anthropic_api_key || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tenants/:id/credits', async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount obrigatório' });
    const t = await one('SELECT id FROM tenants WHERE id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
    const amt = Number(amount);
    await run('UPDATE tenants SET credit_balance = credit_balance + $1 WHERE id = $2', [amt, req.params.id]);
    await run(
      'INSERT INTO credit_transactions (id, tenant_id, amount, type, description) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), req.params.id, amt, amt > 0 ? 'manual_adjustment' : 'manual_debit', description || 'Ajuste manual pelo admin']
    );
    const updated = await one('SELECT credit_balance FROM tenants WHERE id = $1', [req.params.id]);
    res.json({ balance: parseFloat(updated.credit_balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tenants/:id/stats', async (req, res) => {
  try {
    const id = req.params.id;
    const [campaigns, messages, spent, transactions, instances] = await Promise.all([
      one("SELECT COUNT(*) as n FROM campaigns WHERE tenant_id = $1", [id]),
      one("SELECT COUNT(*) as n FROM messages m JOIN campaigns c ON c.id = m.campaign_id WHERE c.tenant_id = $1", [id]),
      one("SELECT ROUND(ABS(SUM(amount))::numeric,4) as n FROM credit_transactions WHERE tenant_id = $1 AND type = 'usage'", [id]),
      all("SELECT * FROM credit_transactions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20", [id]),
      all("SELECT id, name, display_phone, display_name, status FROM whatsapp_instances WHERE tenant_id = $1", [id]),
    ]);
    res.json({
      campaigns:    parseInt(campaigns.n),
      messages:     parseInt(messages.n),
      spent:        parseFloat(spent.n) || 0,
      transactions,
      instances,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   INSTÂNCIAS WHATSAPP (gerenciamento pelo admin)
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/instances', async (req, res) => {
  try {
    const instances = await all(`
      SELECT i.*, t.name as tenant_name
      FROM whatsapp_instances i
      LEFT JOIN tenants t ON t.id = i.tenant_id
      ORDER BY i.created_at DESC
    `);
    res.json(instances.map(i => ({ ...i, access_token: i.access_token ? '•••' + i.access_token.slice(-6) : null })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/instances', async (req, res) => {
  try {
    const { name, waba_id, phone_number_id, access_token, display_phone, display_name, tenant_id } = req.body;
    if (!name || !waba_id || !phone_number_id || !access_token)
      return res.status(400).json({ error: 'name, waba_id, phone_number_id e access_token são obrigatórios' });

    if (tenant_id) {
      const tenant = await one('SELECT id FROM tenants WHERE id = $1', [tenant_id]);
      if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const id            = randomUUID();
    const verify_token  = randomUUID();
    await run(
      `INSERT INTO whatsapp_instances
         (id, name, waba_id, phone_number_id, access_token, display_phone, display_name, webhook_verify_token, status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)`,
      [id, name, waba_id, phone_number_id, access_token, display_phone || null, display_name || null, verify_token, tenant_id || null]
    );
    const inst = await one('SELECT * FROM whatsapp_instances WHERE id = $1', [id]);
    res.status(201).json({ ...inst, access_token: '•••' + access_token.slice(-6) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/instances/:id', async (req, res) => {
  try {
    const { name, waba_id, phone_number_id, access_token, display_phone, display_name, status } = req.body;
    const inst = await one('SELECT * FROM whatsapp_instances WHERE id = $1', [req.params.id]);
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    await run(
      `UPDATE whatsapp_instances SET
         name            = COALESCE($1, name),
         waba_id         = COALESCE($2, waba_id),
         phone_number_id = COALESCE($3, phone_number_id),
         access_token    = CASE WHEN $4 IS NOT NULL AND $4 != '' THEN $4 ELSE access_token END,
         display_phone   = COALESCE($5, display_phone),
         display_name    = COALESCE($6, display_name),
         status          = COALESCE($7, status),
         updated_at      = NOW()
       WHERE id = $8`,
      [
        name || null, waba_id || null, phone_number_id || null,
        access_token || null,
        display_phone || null, display_name || null, status || null,
        req.params.id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atribuir instância a um tenant
router.post('/instances/:id/assign', async (req, res) => {
  try {
    const { tenant_id } = req.body;
    const inst = await one('SELECT id FROM whatsapp_instances WHERE id = $1', [req.params.id]);
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    if (tenant_id) {
      const t = await one('SELECT id FROM tenants WHERE id = $1', [tenant_id]);
      if (!t) return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    await run(
      'UPDATE whatsapp_instances SET tenant_id = $1, updated_at = NOW() WHERE id = $2',
      [tenant_id || null, req.params.id]
    );
    res.json({ ok: true, tenant_id: tenant_id || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/instances/:id', async (req, res) => {
  try {
    const inst = await one('SELECT id FROM whatsapp_instances WHERE id = $1', [req.params.id]);
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    const active = await one(
      "SELECT id FROM campaigns WHERE instance_id = $1 AND status IN ('sending','scheduled') LIMIT 1",
      [req.params.id]
    );
    if (active) return res.status(409).json({ error: 'Há campanhas ativas usando esta instância' });

    await run('DELETE FROM whatsapp_instances WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   PRECIFICAÇÃO (por tipo de conversa WhatsApp)
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/pricing', async (req, res) => {
  try {
    res.json(await all('SELECT * FROM pricing'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/pricing', async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Array esperado' });
    await tx(async (client) => {
      for (const item of items) {
        await client.query(
          `UPDATE pricing SET
             meta_base_cost = COALESCE($1, meta_base_cost),
             markup         = COALESCE($2, markup),
             description    = COALESCE($3, description),
             updated_at     = NOW()
           WHERE resource_type = $4`,
          [
            item.meta_base_cost != null ? Number(item.meta_base_cost) : null,
            item.markup         != null ? Number(item.markup)         : null,
            item.description    || null,
            item.resource_type,
          ]
        );
      }
    });
    res.json(await all('SELECT * FROM pricing'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES DO SISTEMA
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/settings', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM system_settings ORDER BY key ASC');
    const masked = rows.map((r) => {
      const sensitive = r.key.includes('token') || r.key.includes('secret') || r.key.includes('key');
      return { ...r, value: sensitive && r.value ? '••••••••' : r.value };
    });
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings/:key', async (req, res) => {
  try {
    const row = await one('SELECT * FROM system_settings WHERE key = $1', [req.params.key]);
    if (!row) return res.status(404).json({ error: 'Configuração não encontrada' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const updates = req.body;
    if (typeof updates !== 'object' || Array.isArray(updates))
      return res.status(400).json({ error: 'Objeto { key: value } esperado' });

    await tx(async (client) => {
      for (const [key, value] of Object.entries(updates)) {
        const exists = await client.query('SELECT key FROM system_settings WHERE key = $1', [key]);
        if (exists.rows.length > 0) {
          await client.query(
            'UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = $2',
            [String(value ?? ''), key]
          );
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   BILLING E LOGS
   ═══════════════════════════════════════════════════════════════════════════ */
router.get('/billing', async (req, res) => {
  try {
    const { limit = 50, offset = 0, tenant_id } = req.query;
    let q = 'SELECT ct.*, t.name as tenant_name FROM credit_transactions ct JOIN tenants t ON t.id = ct.tenant_id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (tenant_id) { q += ` AND ct.tenant_id = $${idx++}`; params.push(tenant_id); }
    q += ` ORDER BY ct.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const countQ = tenant_id
      ? 'SELECT COUNT(*) as n FROM credit_transactions WHERE tenant_id = $1'
      : 'SELECT COUNT(*) as n FROM credit_transactions';
    const [transactions, total] = await Promise.all([
      all(q, params),
      one(countQ, tenant_id ? [tenant_id] : []),
    ]);
    res.json({ transactions, total: parseInt(total.n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const { level, category, limit = 100, offset = 0 } = req.query;
    let q = 'SELECT * FROM logs WHERE 1=1';
    const params = [];
    let idx = 1;
    if (level)    { q += ` AND level = $${idx++}`;    params.push(level); }
    if (category) { q += ` AND category = $${idx++}`; params.push(category); }
    q += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));
    res.json(await all(q, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
