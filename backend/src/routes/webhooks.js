const express = require('express');
const { randomUUID } = require('crypto');
const { one, all, run, getSetting } = require('../db/database');

const router = express.Router();

/* ─────────────────────────────────────────────────────────────────────────
   Opt-out keywords
   ───────────────────────────────────────────────────────────────────────── */
const OPT_OUT_KEYWORDS = new Set([
  'stop', 'parar', 'pare', 'cancelar', 'cancel', 'sair',
  'remove', 'remover', 'unsubscribe', 'descadastrar', 'descadastre',
  'sair da lista', 'nao quero', 'não quero',
]);

function isOptOut(text) {
  return OPT_OUT_KEYWORDS.has((text || '').trim().toLowerCase());
}

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/webhooks/meta — verificação de webhook Meta (challenge)
   ───────────────────────────────────────────────────────────────────────── */
router.get('/meta', async (req, res) => {
  try {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe') return res.status(403).send('Mode inválido');

    const [instance, globalToken] = await Promise.all([
      one('SELECT id FROM whatsapp_instances WHERE webhook_verify_token = $1', [token]),
      getSetting('meta_webhook_verify_token', 'META_WEBHOOK_VERIFY_TOKEN'),
    ]);

    if (instance || (globalToken && token === globalToken)) {
      return res.status(200).send(challenge);
    }

    res.status(403).send('Token de verificação inválido');
  } catch (err) {
    res.status(500).send('Erro interno');
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/webhooks/meta — receber eventos da Meta
   ───────────────────────────────────────────────────────────────────────── */
router.post('/meta', async (req, res) => {
  // Meta espera resposta 200 imediata
  res.status(200).json({ ok: true });

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;

        // Identificar a instância pelo phone_number_id
        const phoneNumberId = value.metadata?.phone_number_id;
        const instance = phoneNumberId
          ? await one('SELECT * FROM whatsapp_instances WHERE phone_number_id = $1', [phoneNumberId])
          : null;

        // ── Status updates ──────────────────────────────────────────────
        for (const status of value.statuses || []) {
          await processStatusUpdate(status, instance);
        }

        // ── Mensagens recebidas (inbound) ────────────────────────────────
        for (const message of value.messages || []) {
          await processInboundMessage(message, instance, value.contacts);
        }
      }
    }
  } catch (err) {
    console.error('[webhook/meta] Erro ao processar:', err.message);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   Processar atualização de status de mensagem enviada
   ───────────────────────────────────────────────────────────────────────── */
async function processStatusUpdate(status, instance) {
  const { id: metaId, status: statusStr, pricing, errors } = status;

  const conversationType = pricing?.category?.toLowerCase() || null;
  const errorMsg         = errors?.[0]?.message || null;

  await run(
    `UPDATE messages SET
       status            = $1,
       conversation_type = COALESCE($2, conversation_type),
       error_message     = COALESCE($3, error_message),
       updated_at        = NOW()
     WHERE meta_message_id = $4`,
    [statusStr, conversationType, errorMsg, metaId]
  );

  // Atualizar contadores da campanha
  if (['delivered', 'read', 'failed'].includes(statusStr)) {
    const msg = await one('SELECT campaign_id FROM messages WHERE meta_message_id = $1', [metaId]);
    if (msg?.campaign_id) {
      const counts = await one(`
        SELECT
          SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered,
          SUM(CASE WHEN status='read'      THEN 1 ELSE 0 END) as read_count,
          SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) as failed_count
        FROM messages WHERE campaign_id = $1
      `, [msg.campaign_id]);

      await run(
        'UPDATE campaigns SET delivered = $1, read_count = $2, failed_count = $3 WHERE id = $4',
        [parseInt(counts.delivered) || 0, parseInt(counts.read_count) || 0, parseInt(counts.failed_count) || 0, msg.campaign_id]
      );
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Processar mensagem inbound (cliente enviou para nós)
   ───────────────────────────────────────────────────────────────────────── */
async function processInboundMessage(message, instance, contacts) {
  if (!instance) return;
  const tenantId = instance.tenant_id;
  if (!tenantId) return;

  const from        = message.from;
  const msgBody     = message.text?.body || message.caption || `[${message.type}]`;
  const msgType     = message.type || 'text';
  const metaMsgId   = message.id;
  const contactInfo = contacts?.find(c => c.wa_id === from);
  const contactName = contactInfo?.profile?.name || null;

  // Detectar opt-out
  if (msgType === 'text' && isOptOut(msgBody)) {
    await run(
      `INSERT INTO optouts (id, phone, tenant_id, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE SET
         tenant_id    = EXCLUDED.tenant_id,
         reason       = EXCLUDED.reason,
         opted_out_at = NOW()`,
      [randomUUID(), from, tenantId, msgBody.trim()]
    );
  }

  // Criar/atualizar conversa
  let conv = await one(
    'SELECT * FROM conversations WHERE tenant_id = $1 AND instance_id = $2 AND contact_phone = $3',
    [tenantId, instance.id, from]
  );

  if (!conv) {
    const convId = randomUUID();
    await run(
      `INSERT INTO conversations
         (id, tenant_id, instance_id, contact_phone, contact_name, last_message_body, last_message_at, unread_count)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)`,
      [convId, tenantId, instance.id, from, contactName, msgBody]
    );
    conv = await one('SELECT * FROM conversations WHERE id = $1', [convId]);
  } else {
    await run(
      `UPDATE conversations SET
         last_message_body = $1, last_message_at = NOW(),
         unread_count = unread_count + 1,
         contact_name = COALESCE($2, contact_name)
       WHERE id = $3`,
      [msgBody, contactName, conv.id]
    );
  }

  await run(
    `INSERT INTO conversation_messages
       (id, conversation_id, direction, body, message_type, meta_message_id, status)
     VALUES ($1, $2, 'inbound', $3, $4, $5, 'received')`,
    [randomUUID(), conv.id, msgBody, msgType, metaMsgId]
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Opt-outs (admin)
   ───────────────────────────────────────────────────────────────────────── */
router.get('/optouts', async (req, res) => {
  try {
    const { limit = 100, offset = 0, tenant_id } = req.query;
    let q = 'SELECT * FROM optouts WHERE 1=1';
    const params = [];
    let idx = 1;
    if (tenant_id) { q += ` AND tenant_id = $${idx++}`; params.push(tenant_id); }
    q += ` ORDER BY opted_out_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const [rows, total] = await Promise.all([
      all(q, params),
      one('SELECT COUNT(*) as n FROM optouts'),
    ]);
    res.json({ total: parseInt(total.n), rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/optouts/:phone', async (req, res) => {
  try {
    await run('DELETE FROM optouts WHERE phone = $1', [decodeURIComponent(req.params.phone)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
