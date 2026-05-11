const express = require('express');
const { randomUUID } = require('crypto');
const { one, all, run } = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { submitTemplate, syncTemplateStatus } = require('../services/whatsapp');
const { writeLog } = require('./logs');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────────── */

function parseTemplate(t) {
  return {
    ...t,
    variables: JSON.parse(t.variables || '[]'),
    buttons:   JSON.parse(t.buttons   || '[]'),
  };
}

/** Extrai {{1}}, {{2}}... ou {{nome}}, {{email}}... do body */
function extractVariables(body) {
  const matches = body.match(/\{\{[^}]+\}\}/g) || [];
  return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '').trim()))];
}

/* ─────────────────────────────────────────────────────────────────────────
   LISTAR templates do tenant
   ───────────────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    let q = 'SELECT * FROM templates WHERE tenant_id = $1';
    const params = [req.auth.tenantId];
    let idx = 2;
    if (status)   { q += ` AND meta_status = $${idx++}`;  params.push(status); }
    if (category) { q += ` AND category = $${idx++}`;     params.push(category.toUpperCase()); }
    q += ' ORDER BY created_at DESC';
    res.json((await all(q, params)).map(parseTemplate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   BUSCAR template por ID
   ───────────────────────────────────────────────────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const t = await one('SELECT * FROM templates WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });
    res.json(parseTemplate(t));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   CRIAR template (fica como draft até submeter para aprovação)
   ───────────────────────────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const {
      name, category = 'MARKETING', language = 'pt_BR',
      header_type = 'none', header_content,
      body, footer, buttons = [],
    } = req.body;

    if (!name || !body) return res.status(400).json({ error: 'name e body são obrigatórios' });

    const validCategories = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
    if (!validCategories.includes(category.toUpperCase()))
      return res.status(400).json({ error: `category deve ser: ${validCategories.join(', ')}` });

    const metaName  = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const variables = extractVariables(body);
    const id        = randomUUID();

    await run(
      `INSERT INTO templates
         (id, tenant_id, name, category, language, meta_status,
          header_type, header_content, body, footer, buttons, variables)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11)`,
      [
        id, req.auth.tenantId, metaName, category.toUpperCase(), language,
        header_type, header_content || null,
        body, footer || null,
        JSON.stringify(buttons),
        JSON.stringify(variables),
      ]
    );

    res.status(201).json(parseTemplate(await one('SELECT * FROM templates WHERE id = $1', [id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   EDITAR template (apenas drafts ou rejeitados podem ser editados)
   ───────────────────────────────────────────────────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const t = await one('SELECT * FROM templates WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });

    if (!['draft', 'rejected'].includes(t.meta_status))
      return res.status(409).json({ error: `Não é possível editar template com status "${t.meta_status}". Apenas drafts e rejeitados podem ser alterados.` });

    const { name, category, language, header_type, header_content, body, footer, buttons } = req.body;

    const metaName  = name
      ? name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
      : t.name;
    const variables = body ? extractVariables(body) : JSON.parse(t.variables);

    await run(
      `UPDATE templates SET
         name             = $1,
         category         = COALESCE($2, category),
         language         = COALESCE($3, language),
         header_type      = COALESCE($4, header_type),
         header_content   = COALESCE($5, header_content),
         body             = COALESCE($6, body),
         footer           = COALESCE($7, footer),
         buttons          = $8,
         variables        = $9,
         meta_status      = 'draft',
         meta_template_id = NULL,
         rejection_reason = NULL,
         updated_at       = NOW()
       WHERE id = $10`,
      [
        metaName,
        category?.toUpperCase() || null,
        language || null,
        header_type || null,
        header_content !== undefined ? header_content : null,
        body || null,
        footer !== undefined ? footer : null,
        JSON.stringify(buttons || JSON.parse(t.buttons)),
        JSON.stringify(variables),
        req.params.id,
      ]
    );

    res.json(parseTemplate(await one('SELECT * FROM templates WHERE id = $1', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   SUBMETER template para aprovação na Meta
   ───────────────────────────────────────────────────────────────────────── */
router.post('/:id/submit', async (req, res) => {
  const { instance_id } = req.body;
  if (!instance_id) return res.status(400).json({ error: 'instance_id obrigatório para submeter template' });

  try {
    const t = await one('SELECT * FROM templates WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });

    if (!['draft', 'rejected'].includes(t.meta_status))
      return res.status(409).json({ error: `Template já está com status "${t.meta_status}"` });

    const result = await submitTemplate(t, req.auth.tenantId, instance_id);

    await run(
      `UPDATE templates SET
         meta_template_id = $1,
         meta_status      = 'pending',
         submitted_at     = NOW(),
         rejection_reason = NULL,
         updated_at       = NOW()
       WHERE id = $2`,
      [result.meta_template_id, req.params.id]
    );

    writeLog(req.auth.tenantId, req.auth.sub, 'info', 'template', `Template submetido para aprovação: ${t.name}`, { templateId: t.id });
    res.json(parseTemplate(await one('SELECT * FROM templates WHERE id = $1', [req.params.id])));
  } catch (err) {
    writeLog(req.auth.tenantId, req.auth.sub, 'error', 'template', `Erro ao submeter template: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   SINCRONIZAR status do template com Meta
   ───────────────────────────────────────────────────────────────────────── */
router.post('/:id/sync', async (req, res) => {
  const { instance_id } = req.body;
  if (!instance_id) return res.status(400).json({ error: 'instance_id obrigatório' });

  try {
    const t = await one('SELECT * FROM templates WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });
    if (!t.meta_template_id) return res.status(400).json({ error: 'Template ainda não foi submetido para a Meta' });

    const result = await syncTemplateStatus(t.meta_template_id, instance_id, req.auth.tenantId);

    await run(
      `UPDATE templates SET
         meta_status      = $1,
         rejection_reason = $2,
         approved_at      = CASE WHEN $1 = 'approved' AND approved_at IS NULL THEN NOW() ELSE approved_at END,
         updated_at       = NOW()
       WHERE id = $3`,
      [result.meta_status, result.rejection_reason || null, req.params.id]
    );

    res.json(parseTemplate(await one('SELECT * FROM templates WHERE id = $1', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   EXCLUIR template
   ───────────────────────────────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const t = await one('SELECT id, meta_status FROM templates WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!t) return res.status(404).json({ error: 'Template não encontrado' });

    const inUse = await one(
      "SELECT id FROM campaigns WHERE template_id = $1 AND status IN ('draft','scheduled','sending') LIMIT 1",
      [req.params.id]
    );
    if (inUse) return res.status(409).json({ error: 'Template em uso por uma campanha ativa' });

    await run('DELETE FROM templates WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.extractVariables = extractVariables;
