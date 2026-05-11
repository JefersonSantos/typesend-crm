const express = require('express');
const { randomUUID } = require('crypto');
const { one, all, run } = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { sendTextMessage } = require('../services/whatsapp');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

/* ─────────────────────────────────────────────────────────────────────────
   LISTAR conversas do tenant
   ───────────────────────────────────────────────────────────────────────── */
router.get('/conversations', async (req, res) => {
  try {
    const { instance_id } = req.query;
    let q = `
      SELECT c.*, i.name as instance_name, i.display_phone as instance_phone
      FROM conversations c
      LEFT JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE c.tenant_id = $1
    `;
    const params = [req.auth.tenantId];
    if (instance_id) { q += ' AND c.instance_id = $2'; params.push(instance_id); }
    q += ' ORDER BY c.last_message_at DESC NULLS LAST';
    res.json(await all(q, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   BUSCAR mensagens de uma conversa
   ───────────────────────────────────────────────────────────────────────── */
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conv = await one('SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    const messages = await all('SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY sent_at ASC', [req.params.id]);
    await run('UPDATE conversations SET unread_count = 0 WHERE id = $1', [req.params.id]);

    res.json({ conversation: conv, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   ENVIAR mensagem em uma conversa
   ───────────────────────────────────────────────────────────────────────── */
router.post('/conversations/:id/send', async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

    const conv = await one('SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!conv.instance_id) return res.status(400).json({ error: 'Conversa não tem instância associada' });

    const msgId = randomUUID();
    await run(
      "INSERT INTO conversation_messages (id, conversation_id, direction, body, message_type, status) VALUES ($1, $2, 'outbound', $3, 'text', 'queued')",
      [msgId, conv.id, body]
    );

    try {
      const result = await sendTextMessage({
        to: conv.contact_phone, text: body,
        instanceId: conv.instance_id, tenantId: req.auth.tenantId,
      });
      await run("UPDATE conversation_messages SET status = $1, meta_message_id = $2 WHERE id = $3", ['sent', result.meta_message_id, msgId]);
      await run("UPDATE conversations SET last_message_body = $1, last_message_at = NOW() WHERE id = $2", [body, conv.id]);
      res.status(201).json(await one('SELECT * FROM conversation_messages WHERE id = $1', [msgId]));
    } catch (err) {
      await run("UPDATE conversation_messages SET status = 'failed' WHERE id = $1", [msgId]);
      res.status(500).json({ error: err.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   INICIAR nova conversa (outbound direto)
   ───────────────────────────────────────────────────────────────────────── */
router.post('/conversations', async (req, res) => {
  try {
    const { phone, body, instance_id, contact_name } = req.body;
    if (!phone || !body || !instance_id) return res.status(400).json({ error: 'phone, body e instance_id são obrigatórios' });

    const instance = await one(
      "SELECT id FROM whatsapp_instances WHERE id = $1 AND tenant_id = $2 AND status = 'active'",
      [instance_id, req.auth.tenantId]
    );
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada ou inativa' });

    let conv = await one('SELECT * FROM conversations WHERE tenant_id = $1 AND instance_id = $2 AND contact_phone = $3', [req.auth.tenantId, instance_id, phone]);
    if (!conv) {
      const convId = randomUUID();
      await run(
        "INSERT INTO conversations (id, tenant_id, instance_id, contact_phone, contact_name, last_message_body, last_message_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
        [convId, req.auth.tenantId, instance_id, phone, contact_name || null, body]
      );
      conv = await one('SELECT * FROM conversations WHERE id = $1', [convId]);
    }

    const msgId = randomUUID();
    await run(
      "INSERT INTO conversation_messages (id, conversation_id, direction, body, message_type, status) VALUES ($1, $2, 'outbound', $3, 'text', 'queued')",
      [msgId, conv.id, body]
    );

    try {
      const result = await sendTextMessage({ to: phone, text: body, instanceId: instance_id, tenantId: req.auth.tenantId });
      await run("UPDATE conversation_messages SET status = $1, meta_message_id = $2 WHERE id = $3", ['sent', result.meta_message_id, msgId]);
      await run("UPDATE conversations SET last_message_body = $1, last_message_at = NOW() WHERE id = $2", [body, conv.id]);
      res.status(201).json({ conversation: conv, message: await one('SELECT * FROM conversation_messages WHERE id = $1', [msgId]) });
    } catch (err) {
      await run("UPDATE conversation_messages SET status = 'failed' WHERE id = $1", [msgId]);
      res.status(500).json({ error: err.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   TOTAL de não lidas
   ───────────────────────────────────────────────────────────────────────── */
router.get('/unread', async (req, res) => {
  try {
    const row = await one('SELECT SUM(unread_count) as n FROM conversations WHERE tenant_id = $1', [req.auth.tenantId]);
    res.json({ unread: parseInt(row.n) || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
