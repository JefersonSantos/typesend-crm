const express    = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const { one, run, getSetting } = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/* ── Helper: resolve API key for a tenant ────────────────────────────────── */
async function resolveAIConfig(tenantId) {
  let apiKey = null;
  let source = 'none';

  // 1. Per-tenant key
  if (tenantId) {
    const tenant = await one('SELECT anthropic_api_key FROM tenants WHERE id = $1', [tenantId]);
    if (tenant?.anthropic_api_key?.trim()) {
      apiKey = tenant.anthropic_api_key.trim();
      source = 'tenant';
    }
  }

  // 2. Global system setting
  if (!apiKey) {
    const globalKey = await getSetting('anthropic_api_key', 'ANTHROPIC_API_KEY');
    if (globalKey) { apiKey = globalKey; source = 'global'; }
  }

  const model = (await getSetting('anthropic_model')) || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  return { apiKey, model, source };
}

/* ── GET /ai/status ──────────────────────────────────────────────────────── */
router.get('/status', tenantOnly, async (req, res) => {
  try {
    const { apiKey, model, source } = await resolveAIConfig(req.auth.tenantId);
    res.json({
      configured: !!apiKey,
      source,
      model,
      keyHint: apiKey ? apiKey.slice(0, 10) + '...' : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT /ai/connect ─────────────────────────────────────────────────────── */
router.put('/connect', tenantOnly, async (req, res) => {
  const { api_key } = req.body;
  if (!api_key || !api_key.trim()) return res.status(400).json({ error: 'api_key obrigatório' });

  // Validate the key by making a minimal API call
  try {
    const client = new Anthropic({ apiKey: api_key.trim() });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: 'API Key inválida ou sem permissão' });
    if (err.status !== 400) return res.status(502).json({ error: `Erro ao validar key: ${err.message}` });
    // 400 "invalid request" is ok — key itself is valid
  }

  try {
    await run('UPDATE tenants SET anthropic_api_key = $1 WHERE id = $2', [api_key.trim(), req.auth.tenantId]);
    res.json({ ok: true, source: 'tenant', keyHint: api_key.trim().slice(0, 10) + '...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE /ai/connect ──────────────────────────────────────────────────── */
router.delete('/connect', tenantOnly, async (req, res) => {
  try {
    await run('UPDATE tenants SET anthropic_api_key = NULL WHERE id = $1', [req.auth.tenantId]);
    const { apiKey, source } = await resolveAIConfig(req.auth.tenantId);
    res.json({ ok: true, source, configured: !!apiKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /ai/suggest ────────────────────────────────────────────────────── */
router.post('/suggest', tenantOnly, async (req, res) => {
  const { context, tone = 'profissional', category = 'MARKETING', maxChars = 1024 } = req.body;
  if (!context) return res.status(400).json({ error: 'context obrigatório' });

  try {
    const { apiKey, model } = await resolveAIConfig(req.auth.tenantId);
    if (!apiKey) return res.status(503).json({ error: 'IA não configurada. Conecte uma API Key em Configurações.' });

    const categoryDesc = {
      MARKETING:      'marketing/promoção (categoria MARKETING no WhatsApp Business)',
      UTILITY:        'transacional/utilitário, ex: confirmação de pedido, alerta de entrega (categoria UTILITY)',
      AUTHENTICATION: 'autenticação/OTP (categoria AUTHENTICATION)',
    }[category] || 'mensagem WhatsApp Business';

    const client  = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Você é um especialista em copywriting para WhatsApp Business.
Crie 3 opções de corpo (body) para um template ${categoryDesc}.
Contexto da campanha: "${context}"

Regras:
- Tom: ${tone}
- Máximo ${maxChars} caracteres cada
- Use variáveis como {{1}}, {{2}} (formato Meta) para personalização quando fizer sentido
- Seja direto, convincente e com CTA claro
- NÃO inclua header, footer ou botões — apenas o texto do corpo
- Retorne APENAS as 3 opções numeradas (1. 2. 3.), sem explicações adicionais`,
      }],
    });
    const text        = message.content[0].text;
    const suggestions = text.split(/\n\d+[.)]\s*/).filter(Boolean).map(s => s.trim());
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /ai/improve ────────────────────────────────────────────────────── */
router.post('/improve', tenantOnly, async (req, res) => {
  const { body, goal = 'aumentar conversão' } = req.body;
  if (!body) return res.status(400).json({ error: 'body obrigatório' });

  try {
    const { apiKey, model } = await resolveAIConfig(req.auth.tenantId);
    if (!apiKey) return res.status(503).json({ error: 'IA não configurada.' });

    const client  = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Melhore este corpo de template WhatsApp Business para ${goal}. Mantenha variáveis no formato {{1}}, {{2}} se existirem. Retorne só o texto melhorado, sem explicações:\n\n"${body}"`,
      }],
    });
    res.json({ improved: message.content[0].text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
