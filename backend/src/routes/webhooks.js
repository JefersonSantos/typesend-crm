const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

/* ── Opt-out keywords (case-insensitive, trimmed) ────────────────────────── */
const OPT_OUT_KEYWORDS = new Set([
  'stop', 'parar', 'pare', 'cancelar', 'cancel', 'sair',
  'remove', 'remover', 'unsubscribe', 'descadastrar', 'descadastre',
  'sair da lista', 'nao quero', 'não quero',
]);

function isOptOut(body) {
  return OPT_OUT_KEYWORDS.has(body.trim().toLowerCase());
}

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

/* ── Twilio inbound SMS (Chat + Opt-out) ─────────────────────────────────── */
router.post('/inbound', (req, res) => {
  const { From, To, Body, MessageSid } = req.body;
  if (!From || !Body) return res.status(400).send('Dados ausentes');

  /* ── Opt-out detection ─────────────────────────────────────────────────── */
  if (isOptOut(Body)) {
    // Find tenant for context (best-effort)
    const allTenants = db.prepare("SELECT id FROM tenants WHERE status = 'active'").all();
    const tenantId = allTenants[0]?.id || null;

    // Register opt-out globally (phone-level)
    db.prepare('INSERT OR REPLACE INTO optouts (id, phone, reason, tenant_id) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), From, Body.trim(), tenantId);

    // Log conversation message for visibility
    if (tenantId) {
      let conv = db.prepare('SELECT * FROM conversations WHERE tenant_id = ? AND contact_phone = ?').get(tenantId, From);
      if (!conv) {
        const convId = uuidv4();
        db.prepare("INSERT INTO conversations (id, tenant_id, contact_phone, last_message_at, last_message_body) VALUES (?, ?, ?, datetime('now'), ?)").run(convId, tenantId, From, Body);
        conv = { id: convId };
      } else {
        db.prepare("UPDATE conversations SET last_message_body = ?, last_message_at = datetime('now'), unread_count = unread_count + 1 WHERE id = ?").run(Body, conv.id);
      }
      db.prepare("INSERT INTO conversation_messages (id, conversation_id, direction, body, twilio_sid) VALUES (?, ?, 'inbound', ?, ?)").run(uuidv4(), conv.id, Body, MessageSid);
    }

    // Acknowledge opt-out with TwiML response
    return res.status(200).type('text/xml').send(
      '<Response><Message>Você foi removido com sucesso. Para voltar a receber mensagens, entre em contato conosco.</Message></Response>'
    );
  }

  /* ── Regular inbound message → Chat ───────────────────────────────────── */
  const allTenants = db.prepare("SELECT id FROM tenants WHERE status = 'active'").all();
  let tenantId = allTenants[0]?.id;

  if (!tenantId) return res.status(200).send('<Response></Response>');

  let conv = db.prepare('SELECT * FROM conversations WHERE tenant_id = ? AND contact_phone = ?').get(tenantId, From);
  if (!conv) {
    const convId = uuidv4();
    db.prepare("INSERT INTO conversations (id, tenant_id, contact_phone, last_message_at, last_message_body) VALUES (?, ?, ?, datetime('now'), ?)").run(convId, tenantId, From, Body);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  } else {
    db.prepare("UPDATE conversations SET last_message_body = ?, last_message_at = datetime('now'), unread_count = unread_count + 1 WHERE id = ?").run(Body, conv.id);
  }

  db.prepare("INSERT INTO conversation_messages (id, conversation_id, direction, body, twilio_sid) VALUES (?, ?, 'inbound', ?, ?)").run(uuidv4(), conv.id, Body, MessageSid);
  res.status(200).send('<Response></Response>');
});

/* ── GET /optouts — list opted-out phones (admin) ────────────────────────── */
router.get('/optouts', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const total = db.prepare('SELECT COUNT(*) as n FROM optouts').get().n;
  const rows = db.prepare('SELECT * FROM optouts ORDER BY opted_out_at DESC LIMIT ? OFFSET ?').all(Number(limit), Number(offset));
  res.json({ total, rows });
});

/* ── DELETE /optouts/:phone — remove from opt-out (re-subscribe) ─────────── */
router.delete('/optouts/:phone', (req, res) => {
  db.prepare('DELETE FROM optouts WHERE phone = ?').run(decodeURIComponent(req.params.phone));
  res.json({ ok: true });
});

module.exports = router;
