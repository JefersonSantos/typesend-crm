/**
 * Phone lookup service.
 * NOTE: Twilio Lookup was removed. This stub marks all numbers as valid.
 * Replace with an alternative provider (e.g. Numverify, Meta Cloud API) if needed.
 */
const { all, run } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

async function lookupPhone(/* phone */) {
  return { valid: true, line_type: 'mobile', carrier: null, country_code: null, error: null };
}

function estimateLookup(contactCount) {
  return { contactCount, perLookup: 0, twilioBase: 0, markup: 0, totalCost: 0 };
}

async function runListLookup(listId, tenantId, onProgress) {
  const contacts = await all('SELECT * FROM list_contacts WHERE list_id = $1', [listId]);
  if (!contacts.length) throw new Error('Lista sem contatos');

  let done = 0;
  const total = contacts.length;

  for (const contact of contacts) {
    const result = await lookupPhone(contact.phone);
    await run(
      `INSERT INTO lookup_results
         (id, tenant_id, list_id, contact_id, phone, valid, line_type, carrier, country_code, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (contact_id) DO UPDATE SET
         valid        = EXCLUDED.valid,
         line_type    = EXCLUDED.line_type,
         carrier      = EXCLUDED.carrier,
         country_code = EXCLUDED.country_code,
         error        = EXCLUDED.error,
         looked_up_at = NOW()`,
      [
        uuidv4(), tenantId, listId, contact.id, contact.phone,
        result.valid, result.line_type, result.carrier, result.country_code, result.error,
      ]
    );
    done++;
    if (onProgress) onProgress({ done, total, phone: contact.phone, result });
  }

  return { done, total, totalCost: 0 };
}

module.exports = { lookupPhone, estimateLookup, runListLookup };
