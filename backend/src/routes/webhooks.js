const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

/* ── Twilio status callback ──────────────────────────────────────────────── */
router.post('/twilio', (req, res) => {
  const { MessageSid, MessageStatus, ErrorMessage, Price } = req.body;
  if (!MessageSid) return res.status(400).send('MessageSid ausente');

  const cost = Price ? Math.abs(parseFloat(Price)) : null;
  db.prepare(`
    UPDATE messages SET status = ?, cost = COALESCE(?, cost),
    error_message = COALESCE(?, error_message), updated_at = datetime('now')
    WHERE twilio_sid = ?
  `).run(MessageStatus, cost, ErrorMessage || null, MessageSid);

  if (['delivered', 'failed', 'undelivered'].includes(MessageStatus)) {
    const msg = db.prepare('SELECT campaign_id FROM messages WHERE twilio_sid = ?').get(MessageSid);
    if (msg) {
      const counts = db.prepare(`
        SELECT SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered,
               SUM(CASE WHEN status IN ('failed','undelivered') THEN 1 ELSE 0 END) as failed_count,
               ROUND(SUM(COALESCE(cost,0)), 6) as total_cost
        FROM messages WHERE campaign_id = ?
      `).get(msg.campaign_id);
      db.prepare('UPDATE campaigns SET delivered = ?, failed_count = ?, total_cost = ? WHERE id = ?').run(counts.delivered, counts.failed_count, counts.total_cost, msg.campaign_id);
    }
  }
  res.status(200).send('<Response></Response>');
});

/* ── Twilio inbound SMS (for Chat) ───────────────────────────────────────── */
router.post('/inbound', (req, res) => {
  const { From, To, Body, MessageSid } = req.body;
  if (!From || !Body) return res.status(400).send('Dados ausentes');

  // Find tenant by Twilio number (stored in tenant.webhook_url via MessagingService)
  // For now, find tenant by matching messaging service sid via twilio_messaging_sid
  const allTenants = db.prepare("SELECT id, twilio_messaging_sid FROM tenants WHERE status = 'active'").all();

  // Simple approach: find the tenant who owns "To" number (you can refine this)
  let tenantId = allTenants[0]?.id; // fallback: first active tenant

  if (!tenantId) return res.status(200).send('<Response></Response>');

  let conv = db.prepare('SELECT * FROM conversations WHERE tenant_id = ? AND contact_phone = ?').get(tenantId, From);
  if (!conv) {
    const convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, tenant_id, contact_phone, last_message_at, last_message_body) VALUES (?, ?, ?, datetime(\'now\'), ?)').run(convId, tenantId, From, Body);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  } else {
    db.prepare("UPDATE conversations SET last_message_body = ?, last_message_at = datetime('now'), unread_count = unread_count + 1 WHERE id = ?").run(Body, conv.id);
  }

  db.prepare("INSERT INTO conversation_messages (id, conversation_id, direction, body, twilio_sid) VALUES (?, ?, 'inbound', ?, ?)").run(uuidv4(), conv.id, Body, MessageSid);
  res.status(200).send('<Response></Response>');
});

module.exports = router;
