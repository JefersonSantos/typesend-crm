const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/database');
const { getSetting } = require('../db/database');
const { authMiddleware, tenantOnly, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/* ── Helper: resolve API key for a tenant ────────────────────────────────── */
function resolveAIConfig(tenantId) {
  let apiKey = null;
  let source = 'none';

  // 1. Per-tenant key
  if (tenantId) {
    const tenant = db.prepare('SELECT anthropic_api_key FROM tenants WHERE id = ?').get(tenantId);
    if (tenant?.anthropic_api_key?.trim()) {
      apiKey = tenant.anthropic_api_key.trim();
      source = 'tenant';
    }
  }

  // 2. Global system setting
  if (!apiKey) {
    const globalKey = getSetting('anthropic_api_key', 'ANTHROPIC_API_KEY');
    if (globalKey) { apiKey = globalKey; source = 'global'; }
  }

  const model = getSetting('anthropic_model') || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  return { apiKey, model, source };
}

/* ── GET /ai/status — Check AI config for the current tenant ─────────────── */
router.get('/status', tenantOnly, (req, res) => {
  const { apiKey, model, source } = resolveAIConfig(req.auth.tenantId);
  res.json({
    configured: !!apiKey,
    source,   // 'tenant' | 'global' | 'none'
    model,
    // Key hint (first 10 chars) — enough to identify which key without exposing it
    keyHint: apiKey ? apiKey.slice(0, 10) + '...' : null,
  });
});

/* ── PUT /ai/connect — Save tenant's own API key ─────────────────────────── */
router.put('/connect', tenantOnly, async (req, res) => {
  const { api_key } = req.body;
  if (!api_key || !api_key.trim()) return res.status(400).json({ error: 'api_key obrigatório' });

  // Validate the key by making a minimal API call
  try {
    const client = new Anthropic({ apiKey: api_key.trim() });
    await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: 'API Key inválida ou sem permissão' });
    if (err.status !== 400) return res.status(502).json({ error: `Erro ao validar key: ${err.message}` });
    // 400 "invalid request" is ok — key itself is valid
  }

  db.prepare('UPDATE tenants SET anthropic_api_key = ? WHERE id = ?').run(api_key.trim(), req.auth.tenantId);
  res.json({ ok: true, source: 'tenant', keyHint: api_key.trim().slice(0, 10) + '...' });
});

/* ── DELETE /ai/connect — Disconnect tenant's key (revert to global) ─────── */
router.delete('/connect', tenantOnly, (req, res) => {
  db.prepare('UPDATE tenants SET anthropic_api_key = NULL WHERE id = ?').run(req.auth.tenantId);
  const { apiKey, source } = resolveAIConfig(req.auth.tenantId);
  res.json({ ok: true, source, configured: !!apiKey });
});

/* ── POST /ai/suggest ────────────────────────────────────────────────────── */
router.post('/suggest', tenantOnly, async (req, res) => {
  const { context, tone = 'profissional', maxChars = 160 } = req.body;
  if (!context) return res.status(400).json({ error: 'context obrigatório' });

  const { apiKey, model } = resolveAIConfig(req.auth.tenantId);
  if (!apiKey) return res.status(503).json({ error: 'IA não configurada. Conecte uma API Key em Configurações.' });

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Você é um especialista em copywriting para SMS marketing.
Crie 3 opções de mensagem SMS para a seguinte campanha:
"${context}"

Regras:
- Tom: ${tone}
- Máximo ${maxChars} caracteres cada
- Use variáveis como {{nome}}, {{cidade}} quando fizer sentido
- Seja direto, convincente e com CTA claro
- Retorne APENAS as 3 opções numeradas, sem explicações adicionais`,
      }],
    });
    const text = message.content[0].text;
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

  const { apiKey, model } = resolveAIConfig(req.auth.tenantId);
  if (!apiKey) return res.status(503).json({ error: 'IA não configurada.' });

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Melhore este SMS para ${goal}. Mantenha variáveis {{nome}} se existirem. Retorne só a versão melhorada:\n\n"${body}"`,
      }],
    });
    res.json({ improved: message.content[0].text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
