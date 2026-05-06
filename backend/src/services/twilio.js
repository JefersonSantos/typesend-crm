const twilio = require('twilio');
const db = require('../db/database');
const { getSetting } = require('../db/database');

/* ── Build a Twilio client for a given tenant (or global fallback) ────────── */
function getClientForTenant(tenantId) {
  let sid, token, messagingSid, webhookBase;

  if (tenantId) {
    const tenant = db.prepare(
      'SELECT twilio_account_sid, twilio_auth_token, twilio_messaging_service_sid, webhook_url FROM tenants WHERE id = ?'
    ).get(tenantId);

    if (tenant) {
      sid          = tenant.twilio_account_sid;
      token        = tenant.twilio_auth_token;
      messagingSid = tenant.twilio_messaging_service_sid;
      webhookBase  = tenant.webhook_url;
    }
  }

  // Fall back to global system_settings / env vars
  if (!sid || !token) {
    sid   = getSetting('twilio_account_sid',  'TWILIO_ACCOUNT_SID');
    token = getSetting('twilio_auth_token',    'TWILIO_AUTH_TOKEN');
  }
  if (!messagingSid) {
    messagingSid = getSetting('twilio_messaging_service_sid', 'TWILIO_MESSAGING_SERVICE_SID');
  }
  if (!webhookBase) {
    webhookBase = getSetting('webhook_base_url', 'WEBHOOK_URL');
  }

  const client = twilio(sid, token);
  return { client, messagingSid, webhookBase };
}

/* ── Global client (for inbound webhooks / status lookups) ───────────────── */
const globalSid   = getSetting('twilio_account_sid',  'TWILIO_ACCOUNT_SID')  || process.env.TWILIO_ACCOUNT_SID;
const globalToken = getSetting('twilio_auth_token',    'TWILIO_AUTH_TOKEN')   || process.env.TWILIO_AUTH_TOKEN;
const client = twilio(globalSid || 'PLACEHOLDER', globalToken || 'PLACEHOLDER');

/* ── Send SMS ─────────────────────────────────────────────────────────────── */
async function sendSMS(to, body, tenantId) {
  const { client: tenantClient, messagingSid, webhookBase } = getClientForTenant(tenantId);

  const params = {
    body,
    messagingServiceSid: messagingSid,
    to,
  };

  if (webhookBase) {
    params.statusCallback = `${webhookBase}/api/webhooks/twilio`;
  }

  const message = await tenantClient.messages.create(params);
  return { sid: message.sid, status: message.status };
}

module.exports = { sendSMS, client, getClientForTenant };
