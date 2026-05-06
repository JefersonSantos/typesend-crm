const db = require('../db/database');

function getPricing(resourceType) {
  const row = db.prepare('SELECT twilio_base_cost, markup FROM pricing WHERE resource_type = ?').get(resourceType);
  return {
    twilioBase: row?.twilio_base_cost ?? 0,
    markup:     row?.markup           ?? 0,
    perUnit:    (row?.twilio_base_cost ?? 0) + (row?.markup ?? 0),
  };
}

function calcMessageCost(body) {
  // Detect UCS-2: any character outside basic GSM-7 set
  const isUCS2 = /[^\x00-\x7F £¤¥§¿À-ÖØ-öø-ÿΔΦΓΛΩΠΨΣΘΞ€]/.test(body);
  const singleLimit = isUCS2 ? 70  : 160;
  const multiLimit  = isUCS2 ? 67  : 153;
  const len = body.length;
  const smsCount = len <= singleLimit ? 1 : Math.ceil(len / multiLimit);
  return { smsCount, encoding: isUCS2 ? 'UCS-2' : 'GSM-7' };
}

function estimateCampaign(templateBody, contactCount) {
  const { smsCount, encoding } = calcMessageCost(templateBody);
  const { twilioBase, markup, perUnit } = getPricing('sms_outbound');
  const totalSMS  = smsCount * contactCount;
  const totalCost = +(totalSMS * perUnit).toFixed(6);

  return {
    smsCount,
    encoding,
    totalSMS,
    perSMS:     +perUnit.toFixed(6),
    twilioBase: +twilioBase.toFixed(6),
    markup:     +markup.toFixed(6),
    totalCost,
    contactCount,
  };
}

async function deductCredits(tenantId, amount, description) {
  const { v4: uuidv4 } = require('uuid');
  db.prepare(
    'UPDATE tenants SET credit_balance = credit_balance - ? WHERE id = ?'
  ).run(amount, tenantId);
  db.prepare(
    'INSERT INTO credit_transactions (id, tenant_id, amount, type, description) VALUES (?, ?, ?, ?, ?)'
  ).run(uuidv4(), tenantId, -amount, 'usage', description);
}

module.exports = { getPricing, calcMessageCost, estimateCampaign, deductCredits };
