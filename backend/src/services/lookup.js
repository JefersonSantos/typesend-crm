const { getClientForTenant } = require('./twilio');
const db = require('../db/database');
const { getPricing, deductCredits } = require('./costCalculator');
const { v4: uuidv4 } = require('uuid');

/**
 * Look up a single phone number via Twilio Lookup V2.
 * Returns { valid, line_type, carrier, country_code, error }
 */
async function lookupPhone(phone, tenantId) {
  const { client } = getClientForTenant(tenantId);
  try {
    const result = await client.lookups.v2.phoneNumbers(phone)
      .fetch({ fields: 'line_type_intelligence' });

    const lti = result.lineTypeIntelligence;
    return {
      valid:        result.valid,
      line_type:    lti?.type         || null,
      carrier:      lti?.carrier_name || null,
      country_code: result.countryCode || null,
      error:        null,
    };
  } catch (err) {
    return { valid: false, line_type: null, carrier: null, country_code: null, error: err.message };
  }
}

/**
 * Estimate cost for looking up all contacts in a list.
 */
function estimateLookup(contactCount) {
  const { twilioBase, markup, perUnit } = getPricing('phone_lookup');
  const total = +(perUnit * contactCount).toFixed(6);
  return { contactCount, perLookup: +perUnit.toFixed(6), twilioBase: +twilioBase.toFixed(6), markup: +markup.toFixed(6), totalCost: total };
}

/**
 * Run lookup on all contacts in a list.
 * Checks balance, deducts, stores results.
 * Calls onProgress({ done, total, phone, result }) for streaming updates.
 */
async function runListLookup(listId, tenantId, onProgress) {
  const contacts = db.prepare('SELECT * FROM list_contacts WHERE list_id = ?').all(listId);
  if (!contacts.length) throw new Error('Lista sem contatos');

  const estimate = estimateLookup(contacts.length);
  const tenant = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(tenantId);
  if (tenant.credit_balance < estimate.totalCost) {
    throw new Error(`Saldo insuficiente. Saldo: $${tenant.credit_balance.toFixed(4)} | Necessário: $${estimate.totalCost.toFixed(4)}`);
  }

  const ins = db.prepare(`
    INSERT INTO lookup_results (id, tenant_id, list_id, contact_id, phone, valid, line_type, carrier, country_code, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contact_id) DO UPDATE SET
      valid=excluded.valid, line_type=excluded.line_type, carrier=excluded.carrier,
      country_code=excluded.country_code, error=excluded.error, looked_up_at=datetime('now')
  `);

  let done = 0;
  const total = contacts.length;

  for (const contact of contacts) {
    const result = await lookupPhone(contact.phone, tenantId);
    ins.run(uuidv4(), tenantId, listId, contact.id, contact.phone,
      result.valid ? 1 : 0, result.line_type, result.carrier, result.country_code, result.error);
    done++;
    if (onProgress) onProgress({ done, total, phone: contact.phone, result });
    // Small delay to stay within Twilio rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  // Deduct actual cost
  await deductCredits(tenantId, estimate.totalCost, `Lookup de ${total} números (lista)`);
  return { done, total, totalCost: estimate.totalCost };
}

module.exports = { lookupPhone, estimateLookup, runListLookup };
