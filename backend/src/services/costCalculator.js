const { one, run } = require('../db/database');
const { randomUUID } = require('crypto');

/* ─────────────────────────────────────────────────────────────────────────
   Tipos de conversa WhatsApp (categoria do template → resource_type)
   ───────────────────────────────────────────────────────────────────────── */

const CONVERSATION_TYPES = {
  MARKETING:      'whatsapp_marketing',
  UTILITY:        'whatsapp_utility',
  AUTHENTICATION: 'whatsapp_authentication',
  SERVICE:        'whatsapp_service',
};

function categoryToResourceType(category) {
  const map = {
    MARKETING:      'whatsapp_marketing',
    UTILITY:        'whatsapp_utility',
    AUTHENTICATION: 'whatsapp_authentication',
  };
  return map[category?.toUpperCase()] || 'whatsapp_marketing';
}

/** Retorna custo total (base Meta + markup) para um resource_type */
async function getPricing(resourceType) {
  const row = await one('SELECT meta_base_cost, markup FROM pricing WHERE resource_type = $1', [resourceType]);
  if (!row) return { base: 0, markup: 0, total: 0 };
  const base   = parseFloat(row.meta_base_cost) || 0;
  const markup = parseFloat(row.markup) || 0;
  return { base, markup, total: +(base + markup).toFixed(6) };
}

/** Custo de uma conversa dado a categoria do template */
async function calcConversationCost(templateCategory) {
  return getPricing(categoryToResourceType(templateCategory));
}

/** Estimativa de custo total de campanha */
async function estimateCampaign(templateCategory, contactCount) {
  const pricing = await calcConversationCost(templateCategory);
  return {
    contact_count:         contactCount,
    cost_per_conversation: pricing.total,
    meta_base_cost:        pricing.base,
    markup:                pricing.markup,
    total_cost:            +(pricing.total * contactCount).toFixed(6),
    resource_type:         categoryToResourceType(templateCategory),
  };
}

/** Debita créditos do tenant e registra transação */
async function deductCredits(tenantId, amount, description) {
  await run('UPDATE tenants SET credit_balance = credit_balance - $1 WHERE id = $2', [amount, tenantId]);
  await run(
    'INSERT INTO credit_transactions (id, tenant_id, amount, type, description) VALUES ($1, $2, $3, $4, $5)',
    [randomUUID(), tenantId, -Math.abs(amount), 'usage', description]
  );
}

module.exports = {
  getPricing,
  categoryToResourceType,
  calcConversationCost,
  estimateCampaign,
  deductCredits,
  CONVERSATION_TYPES,
};
