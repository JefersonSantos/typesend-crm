const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { sendSMS } = require('../services/twilio');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

/* ── List conversations ──────────────────────────────────────────────────── */
router.get('/conversations', (req, res) => {
  const conversations = db.prepare(
    'SELECT * FROM conversations WHERE tenant_id = ? ORDER BY last_message_at DESC'
  ).all(req.auth.tenantId);
  res.json(conversations);
});

/* ── Get messages in a conversation ─────────────────────────────────────── */
router.get('/conversations/:id/messages', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  const messages = db.prepare(
    'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY sent_at ASC'
  ).all(req.params.id);

  // Mark as read
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);

  res.json({ conversation: conv, messages });
});

/* ── Send message from a conversation ───────────────────────────────────── */
router.post('/conversations/:id/send', async (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'Mensagem vazia' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  const msgId = uuidv4();
  db.prepare("INSERT INTO conversation_messages (id, conversation_id, direction, body, status) VALUES (?, ?, 'outbound', ?, 'queued')").run(msgId, conv.id, body);

  try {
    const result = await sendSMS(conv.contact_phone, body, req.auth.tenantId);
    db.prepare("UPDATE conversation_messages SET status = ?, twilio_sid = ? WHERE id = ?").run(result.status, result.sid, msgId);
    db.prepare("UPDATE conversations SET last_message_body = ?, last_message_at = datetime('now') WHERE id = ?").run(body, conv.id);
    res.status(201).json(db.prepare('SELECT * FROM conversation_messages WHERE id = ?').get(msgId));
  } catch (err) {
    db.prepare("UPDATE conversation_messages SET status = 'failed' WHERE id = ?").run(msgId);
    res.status(500).json({ error: err.message });
  }
});

/* ── Unread count ────────────────────────────────────────────────────────── */
router.get('/unread', (req, res) => {
  const row = db.prepare('SELECT SUM(unread_count) as n FROM conversations WHERE tenant_id = ?').get(req.auth.tenantId);
  res.json({ unread: row.n || 0 });
});

module.exports = router;
