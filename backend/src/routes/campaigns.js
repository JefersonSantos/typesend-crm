const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { sendSMS } = require('../services/twilio');
const { renderTemplate } = require('../services/templateRenderer');
const { estimateCampaign, deductCredits } = require('../services/costCalculator');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { writeLog } = require('./logs');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

/* ── List ────────────────────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.*, l.name as list_name, t.name as template_name,
           s.name as segment_name
    FROM campaigns c
    LEFT JOIN lists l ON l.id = c.list_id
    LEFT JOIN templates t ON t.id = c.template_id
    LEFT JOIN segments s ON s.id = c.segment_id
    WHERE c.tenant_id = ? ORDER BY c.created_at DESC
  `).all(req.auth.tenantId);
  res.json(campaigns.map(c => ({ ...c, variable_map: JSON.parse(c.variable_map) })));
});

router.get('/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT COUNT(*) as total_campaigns, SUM(total) as total_messages,
    SUM(delivered) as total_delivered, SUM(failed_count) as total_failed,
    ROUND(SUM(total_cost), 4) as total_cost
    FROM campaigns WHERE tenant_id = ?
  `).get(req.auth.tenantId);
  res.json(stats);
});

router.get('/:id', (req, res) => {
  const c = db.prepare(`
    SELECT c.*, l.name as list_name, l.columns as list_columns, l.phone_column,
           t.name as template_name, t.body as template_body, t.variables as template_variables
    FROM campaigns c
    LEFT JOIN lists l ON l.id = c.list_id
    LEFT JOIN templates t ON t.id = c.template_id
    WHERE c.id = ? AND c.tenant_id = ?
  `).get(req.params.id, req.auth.tenantId);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
  res.json({ ...c, variable_map: JSON.parse(c.variable_map), list_columns: c.list_columns ? JSON.parse(c.list_columns) : [], template_variables: c.template_variables ? JSON.parse(c.template_variables) : [] });
});

router.get('/:id/messages', (req, res) => {
  const { limit = 50, offset = 0, status } = req.query;
  const c = db.prepare('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
  let q = 'SELECT * FROM messages WHERE campaign_id = ?'; const params = [req.params.id];
  if (status) { q += ' AND status = ?'; params.push(status); }
  q += ' ORDER BY sent_at DESC LIMIT ? OFFSET ?'; params.push(Number(limit), Number(offset));
  const total = db.prepare('SELECT COUNT(*) as n FROM messages WHERE campaign_id = ?').get(req.params.id);
  res.json({ messages: db.prepare(q).all(...params), total: total.n });
});

/* ── Estimate cost ───────────────────────────────────────────────────────── */
router.post('/estimate', (req, res) => {
  const { template_id, list_id, segment_id } = req.body;
  const template = db.prepare('SELECT body FROM templates WHERE id = ? AND tenant_id = ?').get(template_id, req.auth.tenantId);
  if (!template) return res.status(404).json({ error: 'Modelo não encontrado' });

  let count;
  if (segment_id) {
    const seg = db.prepare('SELECT contact_count FROM segments WHERE id = ? AND tenant_id = ?').get(segment_id, req.auth.tenantId);
    count = seg?.contact_count || 0;
  } else {
    const list = db.prepare('SELECT contact_count FROM lists WHERE id = ? AND tenant_id = ?').get(list_id, req.auth.tenantId);
    count = list?.contact_count || 0;
  }

  const estimate = estimateCampaign(template.body, count);
  const balance = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(req.auth.tenantId);
  res.json({ ...estimate, balance: balance.credit_balance, sufficient: balance.credit_balance >= estimate.totalCost });
});

/* ── Create ──────────────────────────────────────────────────────────────── */
router.post('/', (req, res) => {
  const { name, list_id, segment_id, template_id, variable_map, scheduled_at } = req.body;
  if (!name || !list_id || !template_id || !variable_map) return res.status(400).json({ error: 'Campos obrigatórios' });

  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND tenant_id = ?').get(list_id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

  const template = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?').get(template_id, req.auth.tenantId);
  if (!template) return res.status(404).json({ error: 'Modelo não encontrado' });

  let contactCount = list.contact_count;
  if (segment_id) {
    const seg = db.prepare('SELECT contact_count FROM segments WHERE id = ? AND tenant_id = ?').get(segment_id, req.auth.tenantId);
    if (seg) contactCount = seg.contact_count;
  }

  const estimate = estimateCampaign(template.body, contactCount);
  const status = scheduled_at ? 'scheduled' : 'draft';
  const id = uuidv4();

  db.prepare(`
    INSERT INTO campaigns (id, tenant_id, name, list_id, segment_id, template_id, variable_map, status, scheduled_at, total, cost_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.auth.tenantId, name, list_id, segment_id || null, template_id, JSON.stringify(variable_map), status, scheduled_at || null, contactCount, estimate.totalCost);

  writeLog(req.auth.tenantId, req.auth.sub, 'info', 'campaign', `Campanha criada: ${name}`, { campaignId: id });
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  res.status(201).json({ ...campaign, variable_map: JSON.parse(campaign.variable_map) });
});

/* ── Send ────────────────────────────────────────────────────────────────── */
router.post('/:id/send', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
  if (!['draft', 'scheduled'].includes(campaign.status)) return res.status(409).json({ error: `Status inválido: ${campaign.status}` });

  // Check credits
  const tenant = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(req.auth.tenantId);
  if (tenant.credit_balance < campaign.cost_estimate) {
    return res.status(402).json({ error: `Créditos insuficientes. Saldo: $${tenant.credit_balance.toFixed(4)} | Estimado: $${campaign.cost_estimate.toFixed(4)}` });
  }

  db.prepare("UPDATE campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?").run(campaign.id);
  writeLog(req.auth.tenantId, req.auth.sub, 'info', 'campaign', `Envio iniciado: ${campaign.name}`, { campaignId: campaign.id });
  res.json({ ok: true });

  process.nextTick(() => runCampaign(campaign.id, req.auth.tenantId));
});

router.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT id, status FROM campaigns WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
  if (c.status === 'sending') return res.status(409).json({ error: 'Não é possível excluir campanha em envio' });
  db.prepare('DELETE FROM messages WHERE campaign_id = ?').run(req.params.id);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

/* ── Campaign runner ─────────────────────────────────────────────────────── */
async function runCampaign(campaignId, tenantId) {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    const variableMap = JSON.parse(campaign.variable_map);
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id);
    const segment = campaign.segment_id ? db.prepare('SELECT filters FROM segments WHERE id = ?').get(campaign.segment_id) : null;
    const filters = segment ? JSON.parse(segment.filters) : [];

    let contacts = db.prepare('SELECT * FROM list_contacts WHERE list_id = ?').all(campaign.list_id);
    if (filters.length) {
      contacts = contacts.filter(c => {
        const data = JSON.parse(c.data);
        return filters.every(f => {
          const val = String(data[f.column] || '').toLowerCase();
          if (f.op === 'contains')    return val.includes(f.value.toLowerCase());
          if (f.op === 'equals')      return val === f.value.toLowerCase();
          if (f.op === 'starts_with') return val.startsWith(f.value.toLowerCase());
          if (f.op === 'not_empty')   return val.length > 0;
          return true;
        });
      });
    }

    db.prepare('UPDATE campaigns SET total = ? WHERE id = ?').run(contacts.length, campaignId);

    const ins = db.prepare('INSERT INTO messages (id, campaign_id, contact_id, phone, body) VALUES (?, ?, ?, ?, ?)');
    let sent = 0, failedCount = 0, totalCost = 0;

    for (const contact of contacts) {
      const contactData = JSON.parse(contact.data);
      const body = renderTemplate(template.body, variableMap, contactData);
      const msgId = uuidv4();
      ins.run(msgId, campaignId, contact.id, contact.phone, body);

      try {
        const result = await sendSMS(contact.phone, body, tenantId);
        db.prepare("UPDATE messages SET status = ?, twilio_sid = ?, updated_at = datetime('now') WHERE id = ?").run(result.status, result.sid, msgId);
        sent++;
      } catch (err) {
        db.prepare("UPDATE messages SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?").run(err.message, msgId);
        failedCount++;
      }
      db.prepare('UPDATE campaigns SET sent = ?, failed_count = ? WHERE id = ?').run(sent, failedCount, campaignId);
      await new Promise(r => setTimeout(r, 110));
    }

    // Deduct estimated cost from credits
    if (campaign.cost_estimate > 0) {
      await deductCredits(tenantId, campaign.cost_estimate, `Campanha: ${campaign.name}`);
    }

    db.prepare("UPDATE campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(campaignId);
    writeLog(tenantId, null, 'info', 'campaign', `Campanha concluída: ${campaign.name}`, { sent, failed: failedCount });
  } catch (err) {
    db.prepare("UPDATE campaigns SET status = 'failed' WHERE id = ?").run(campaignId);
    writeLog(tenantId, null, 'error', 'campaign', `Erro na campanha ${campaignId}: ${err.message}`);
  }
}

module.exports = router;
module.exports.runCampaign = runCampaign;
