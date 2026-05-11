const express = require('express');
const { randomUUID } = require('crypto');
const { one, all, run } = require('../db/database');
const { sendTemplateMessage } = require('../services/whatsapp');
const { renderTemplate } = require('../services/templateRenderer');
const { estimateCampaign, deductCredits } = require('../services/costCalculator');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { writeLog } = require('./logs');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

/* ─────────────────────────────────────────────────────────────────────────
   LISTAR campanhas
   ───────────────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const campaigns = await all(`
      SELECT c.*,
        l.name as list_name,
        t.name as template_name, t.category as template_category, t.meta_status as template_meta_status,
        s.name as segment_name,
        i.name as instance_name, i.display_phone as instance_phone
      FROM campaigns c
      LEFT JOIN lists             l ON l.id = c.list_id
      LEFT JOIN templates         t ON t.id = c.template_id
      LEFT JOIN segments          s ON s.id = c.segment_id
      LEFT JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE c.tenant_id = $1 ORDER BY c.created_at DESC
    `, [req.auth.tenantId]);
    res.json(campaigns.map(c => ({ ...c, variable_map: JSON.parse(c.variable_map) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await one(`
      SELECT COUNT(*) as total_campaigns,
        SUM(total)       as total_messages,
        SUM(delivered)   as total_delivered,
        SUM(read_count)  as total_read,
        SUM(failed_count) as total_failed,
        ROUND(SUM(total_cost)::numeric, 4) as total_cost
      FROM campaigns WHERE tenant_id = $1
    `, [req.auth.tenantId]);
    res.json({
      total_campaigns: parseInt(stats.total_campaigns) || 0,
      total_messages:  parseInt(stats.total_messages)  || 0,
      total_delivered: parseInt(stats.total_delivered) || 0,
      total_read:      parseInt(stats.total_read)      || 0,
      total_failed:    parseInt(stats.total_failed)    || 0,
      total_cost:      parseFloat(stats.total_cost)    || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await one(`
      SELECT c.*,
        l.name as list_name, l.columns as list_columns, l.phone_column,
        t.name as template_name, t.body as template_body, t.variables as template_variables,
        t.category as template_category, t.language as template_language, t.meta_status,
        t.header_type, t.header_content, t.footer, t.buttons as template_buttons,
        i.name as instance_name, i.display_phone as instance_phone
      FROM campaigns c
      LEFT JOIN lists             l ON l.id = c.list_id
      LEFT JOIN templates         t ON t.id = c.template_id
      LEFT JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE c.id = $1 AND c.tenant_id = $2
    `, [req.params.id, req.auth.tenantId]);
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({
      ...c,
      variable_map:       JSON.parse(c.variable_map),
      list_columns:       c.list_columns       ? JSON.parse(c.list_columns)       : [],
      template_variables: c.template_variables ? JSON.parse(c.template_variables) : [],
      template_buttons:   c.template_buttons   ? JSON.parse(c.template_buttons)   : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/messages', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    const c = await one('SELECT id FROM campaigns WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });

    let q = 'SELECT * FROM messages WHERE campaign_id = $1';
    const params = [req.params.id];
    let idx = 2;
    if (status) { q += ` AND status = $${idx++}`; params.push(status); }
    q += ` ORDER BY sent_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const [messages, total] = await Promise.all([
      all(q, params),
      one('SELECT COUNT(*) as n FROM messages WHERE campaign_id = $1', [req.params.id]),
    ]);
    res.json({ messages, total: parseInt(total.n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   ESTIMAR custo da campanha
   ───────────────────────────────────────────────────────────────────────── */
router.post('/estimate', async (req, res) => {
  try {
    const { template_id, list_id, segment_id } = req.body;

    const template = await one('SELECT category FROM templates WHERE id = $1 AND tenant_id = $2', [template_id, req.auth.tenantId]);
    if (!template) return res.status(404).json({ error: 'Template não encontrado' });

    let count;
    if (segment_id) {
      const seg = await one('SELECT contact_count FROM segments WHERE id = $1 AND tenant_id = $2', [segment_id, req.auth.tenantId]);
      count = seg?.contact_count || 0;
    } else {
      const list = await one('SELECT contact_count FROM lists WHERE id = $1 AND tenant_id = $2', [list_id, req.auth.tenantId]);
      count = list?.contact_count || 0;
    }

    const estimate = await estimateCampaign(template.category, count);
    const tenant   = await one('SELECT credit_balance FROM tenants WHERE id = $1', [req.auth.tenantId]);
    const balance  = parseFloat(tenant.credit_balance);
    res.json({ ...estimate, balance, sufficient: balance >= estimate.total_cost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   CRIAR campanha
   ───────────────────────────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { name, list_id, segment_id, template_id, instance_id, variable_map, scheduled_at } = req.body;
    if (!name || !list_id || !template_id || !instance_id || !variable_map)
      return res.status(400).json({ error: 'Campos obrigatórios: name, list_id, template_id, instance_id, variable_map' });

    const [list, template, instance] = await Promise.all([
      one('SELECT * FROM lists WHERE id = $1 AND tenant_id = $2', [list_id, req.auth.tenantId]),
      one('SELECT * FROM templates WHERE id = $1 AND tenant_id = $2', [template_id, req.auth.tenantId]),
      one("SELECT id FROM whatsapp_instances WHERE id = $1 AND tenant_id = $2 AND status = 'active'", [instance_id, req.auth.tenantId]),
    ]);

    if (!list)     return res.status(404).json({ error: 'Lista não encontrada' });
    if (!template) return res.status(404).json({ error: 'Template não encontrado' });
    if (template.meta_status !== 'approved')
      return res.status(422).json({ error: `Template não aprovado (status atual: "${template.meta_status}"). Apenas templates com status "approved" podem ser usados em campanhas.` });
    if (!instance) return res.status(404).json({ error: 'Instância WhatsApp não encontrada ou inativa' });

    let contactCount = list.contact_count;
    if (segment_id) {
      const seg = await one('SELECT contact_count FROM segments WHERE id = $1 AND tenant_id = $2', [segment_id, req.auth.tenantId]);
      if (seg) contactCount = seg.contact_count;
    }

    const estimate = await estimateCampaign(template.category, contactCount);
    const status   = scheduled_at ? 'scheduled' : 'draft';
    const id       = randomUUID();

    await run(
      `INSERT INTO campaigns
         (id, tenant_id, name, list_id, segment_id, template_id, instance_id, variable_map, status, scheduled_at, total, cost_estimate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, req.auth.tenantId, name, list_id, segment_id || null, template_id, instance_id,
       JSON.stringify(variable_map), status, scheduled_at || null, contactCount, estimate.total_cost]
    );

    writeLog(req.auth.tenantId, req.auth.sub, 'info', 'campaign', `Campanha criada: ${name}`, { campaignId: id });
    const campaign = await one('SELECT * FROM campaigns WHERE id = $1', [id]);
    res.status(201).json({ ...campaign, variable_map: JSON.parse(campaign.variable_map) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   ENVIAR campanha
   ───────────────────────────────────────────────────────────────────────── */
router.post('/:id/send', async (req, res) => {
  try {
    const campaign = await one('SELECT * FROM campaigns WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
    if (!['draft', 'scheduled'].includes(campaign.status))
      return res.status(409).json({ error: `Status inválido: ${campaign.status}` });

    const tenant = await one('SELECT credit_balance FROM tenants WHERE id = $1', [req.auth.tenantId]);
    const balance = parseFloat(tenant.credit_balance);
    const costEst = parseFloat(campaign.cost_estimate);
    if (balance < costEst)
      return res.status(402).json({ error: `Saldo insuficiente. Saldo: $${balance.toFixed(4)} | Estimado: $${costEst.toFixed(4)}` });

    await run("UPDATE campaigns SET status = 'sending', started_at = NOW() WHERE id = $1", [campaign.id]);
    writeLog(req.auth.tenantId, req.auth.sub, 'info', 'campaign', `Envio iniciado: ${campaign.name}`, { campaignId: campaign.id });
    res.json({ ok: true });

    process.nextTick(() => runCampaign(campaign.id, req.auth.tenantId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const c = await one('SELECT id, status FROM campaigns WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    if (c.status === 'sending') return res.status(409).json({ error: 'Não é possível excluir campanha em envio' });
    await run('DELETE FROM messages WHERE campaign_id = $1', [req.params.id]);
    await run('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   RUNNER da campanha (assíncrono, fire-and-forget)
   ───────────────────────────────────────────────────────────────────────── */
async function runCampaign(campaignId, tenantId) {
  try {
    const campaign    = await one('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    const template    = await one('SELECT * FROM templates WHERE id = $1', [campaign.template_id]);
    const variableMap = JSON.parse(campaign.variable_map);

    const segment = campaign.segment_id
      ? await one('SELECT filters FROM segments WHERE id = $1', [campaign.segment_id])
      : null;
    const filters = segment ? JSON.parse(segment.filters) : [];

    // Opt-outs do tenant (e globais sem tenant)
    const optOutRows = await all('SELECT phone FROM optouts WHERE tenant_id = $1 OR tenant_id IS NULL', [tenantId]);
    const optedOut   = new Set(optOutRows.map(r => r.phone));

    // Contatos da lista
    let contacts = await all('SELECT * FROM list_contacts WHERE list_id = $1', [campaign.list_id]);
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

    await run('UPDATE campaigns SET total = $1 WHERE id = $2', [contacts.length, campaignId]);

    let sent = 0, failedCount = 0, optedOutCount = 0;
    const variables = JSON.parse(template.variables || '[]');
    const buttons   = JSON.parse(template.buttons   || '[]');

    for (const contact of contacts) {
      if (optedOut.has(contact.phone)) {
        await run(
          "INSERT INTO messages (id, campaign_id, contact_id, phone, body, status, template_id, conversation_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [randomUUID(), campaignId, contact.id, contact.phone, '', 'opted_out', template.id, template.category.toLowerCase()]
        );
        optedOutCount++;
        await run('UPDATE campaigns SET opted_out_count = $1 WHERE id = $2', [optedOutCount, campaignId]);
        continue;
      }

      const contactData  = JSON.parse(contact.data);
      const renderedBody = renderTemplate(template.body, variableMap, contactData);
      const msgId        = randomUUID();

      await run(
        "INSERT INTO messages (id, campaign_id, contact_id, phone, body, status, template_id, conversation_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [msgId, campaignId, contact.id, contact.phone, renderedBody, 'queued', template.id, template.category.toLowerCase()]
      );

      try {
        // Montar components para a API Meta
        const components = [];

        if (template.header_type && template.header_type !== 'none') {
          if (template.header_type === 'text') {
            const renderedHeader = renderTemplate(template.header_content || '', variableMap, contactData);
            if (renderedHeader) components.push({ type: 'header', parameters: [{ type: 'text', text: renderedHeader }] });
          } else {
            components.push({ type: 'header', parameters: [{ type: template.header_type, [template.header_type]: { link: template.header_content } }] });
          }
        }

        if (variables.length) {
          const bodyParams = variables.map(v => {
            const val = variableMap[v] ? renderTemplate(`{{${v}}}`, variableMap, contactData) : (contactData[v] || '');
            return { type: 'text', text: val };
          });
          if (bodyParams.length) components.push({ type: 'body', parameters: bodyParams });
        }

        buttons.forEach((btn, idx) => {
          if (btn.type === 'URL' && btn.url?.includes('{{')) {
            const renderedUrl = renderTemplate(btn.url, variableMap, contactData);
            components.push({ type: 'button', sub_type: 'url', index: String(idx), parameters: [{ type: 'text', text: renderedUrl.split('/').pop() }] });
          }
        });

        const result = await sendTemplateMessage({
          to:           contact.phone,
          templateName: template.name,
          language:     template.language,
          components:   components.length ? components : undefined,
          instanceId:   campaign.instance_id,
          tenantId,
        });

        await run(
          "UPDATE messages SET status = $1, meta_message_id = $2, updated_at = NOW() WHERE id = $3",
          ['sent', result.meta_message_id, msgId]
        );
        sent++;
      } catch (err) {
        await run(
          "UPDATE messages SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
          [err.message, msgId]
        );
        failedCount++;
      }

      await run('UPDATE campaigns SET sent = $1, failed_count = $2 WHERE id = $3', [sent, failedCount, campaignId]);
      await new Promise(r => setTimeout(r, 200)); // respeitar rate limit Meta
    }

    await deductCredits(tenantId, parseFloat(campaign.cost_estimate), `Campanha: ${campaign.name}`);
    await run(
      "UPDATE campaigns SET status = 'completed', completed_at = NOW(), opted_out_count = $1 WHERE id = $2",
      [optedOutCount, campaignId]
    );

    writeLog(tenantId, null, 'info', 'campaign', `Campanha concluída: ${campaign.name}`, { sent, failed: failedCount, opted_out: optedOutCount });
  } catch (err) {
    await run("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaignId]).catch(() => {});
    writeLog(tenantId, null, 'error', 'campaign', `Erro na campanha ${campaignId}: ${err.message}`);
  }
}

module.exports = router;
module.exports.runCampaign = runCampaign;
