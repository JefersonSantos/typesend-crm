const https = require('https');
const { one, getSetting } = require('../db/database');

/* ─────────────────────────────────────────────────────────────────────────
   Meta Graph API helper
   ───────────────────────────────────────────────────────────────────────── */

/** Faz uma chamada à Meta Graph API */
async function metaRequest({ method = 'GET', path, body, accessToken }) {
  const version = (await getSetting('meta_api_version')) || 'v22.0';
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'graph.facebook.com',
      path: `/${version}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          resolve(json);
        } catch (e) {
          reject(new Error(`Resposta inválida da Meta API: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   Instância: resolve token e phone_number_id para um tenant
   ───────────────────────────────────────────────────────────────────────── */

async function getInstanceForTenant(instanceId, tenantId) {
  const instance = await one(
    "SELECT * FROM whatsapp_instances WHERE id = $1 AND tenant_id = $2 AND status = 'active'",
    [instanceId, tenantId]
  );

  if (!instance) throw new Error('Instância não encontrada ou não pertence a este tenant');

  const token = instance.access_token || (await getSetting('meta_global_access_token'));
  if (!token) throw new Error('Access token não configurado para esta instância');

  return { ...instance, resolved_token: token };
}

/* ─────────────────────────────────────────────────────────────────────────
   Enviar mensagem de template
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Envia uma mensagem de template WhatsApp aprovado.
 */
async function sendTemplateMessage({ to, templateName, language, components, instanceId, tenantId }) {
  const instance = await getInstanceForTenant(instanceId, tenantId);

  const body = {
    messaging_product: 'whatsapp',
    to: to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language || 'pt_BR' },
      ...(components?.length ? { components } : {}),
    },
  };

  const result = await metaRequest({
    method: 'POST',
    path: `/${instance.phone_number_id}/messages`,
    body,
    accessToken: instance.resolved_token,
  });

  return { meta_message_id: result.messages?.[0]?.id, status: 'sent' };
}

/* ─────────────────────────────────────────────────────────────────────────
   Enviar mensagem de texto livre (chat)
   ───────────────────────────────────────────────────────────────────────── */

async function sendTextMessage({ to, text, instanceId, tenantId }) {
  const instance = await getInstanceForTenant(instanceId, tenantId);

  const result = await metaRequest({
    method: 'POST',
    path: `/${instance.phone_number_id}/messages`,
    body: {
      messaging_product: 'whatsapp',
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body: text },
    },
    accessToken: instance.resolved_token,
  });

  return { meta_message_id: result.messages?.[0]?.id, status: 'sent' };
}

/* ─────────────────────────────────────────────────────────────────────────
   Marcar mensagem como lida
   ───────────────────────────────────────────────────────────────────────── */

async function markAsRead({ messageId, instanceId, tenantId }) {
  const instance = await getInstanceForTenant(instanceId, tenantId);

  await metaRequest({
    method: 'POST',
    path: `/${instance.phone_number_id}/messages`,
    body: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    },
    accessToken: instance.resolved_token,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   Submeter template para aprovação Meta
   ───────────────────────────────────────────────────────────────────────── */

async function submitTemplate(template, tenantId, instanceId) {
  const instance = await getInstanceForTenant(instanceId, tenantId);

  const components = [];

  // Header
  if (template.header_type && template.header_type !== 'none') {
    const headerComp = { type: 'HEADER', format: template.header_type.toUpperCase() };
    if (template.header_type === 'text') {
      headerComp.text = template.header_content || '';
    } else {
      headerComp.example = { header_handle: [template.header_content || ''] };
    }
    components.push(headerComp);
  }

  // Body
  const variables = JSON.parse(template.variables || '[]');
  const bodyComp = { type: 'BODY', text: template.body };
  if (variables.length) {
    bodyComp.example = {
      body_text: [variables.map((_, i) => `Exemplo ${i + 1}`)],
    };
  }
  components.push(bodyComp);

  // Footer
  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }

  // Buttons
  const buttons = JSON.parse(template.buttons || '[]');
  if (buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: buttons.map((btn) => {
        if (btn.type === 'QUICK_REPLY')  return { type: 'QUICK_REPLY', text: btn.text };
        if (btn.type === 'URL')          return { type: 'URL', text: btn.text, url: btn.url };
        if (btn.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: btn.text, phone_number: btn.phone };
        return btn;
      }),
    });
  }

  const result = await metaRequest({
    method: 'POST',
    path: `/${instance.waba_id}/message_templates`,
    body: {
      name:       template.name,
      category:   template.category,
      language:   template.language,
      components,
    },
    accessToken: instance.resolved_token,
  });

  return { meta_template_id: result.id, meta_status: result.status };
}

/* ─────────────────────────────────────────────────────────────────────────
   Sincronizar status de template com Meta
   ───────────────────────────────────────────────────────────────────────── */

async function syncTemplateStatus(metaTemplateId, instanceId, tenantId) {
  const instance = await getInstanceForTenant(instanceId, tenantId);

  const result = await metaRequest({
    method: 'GET',
    path: `/${metaTemplateId}?fields=id,name,status,quality_score,rejection_reason`,
    accessToken: instance.resolved_token,
  });

  return {
    meta_status:      result.status?.toLowerCase() || 'pending',
    rejection_reason: result.rejection_reason || null,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Validar se número tem WhatsApp
   ───────────────────────────────────────────────────────────────────────── */

async function validateWhatsAppNumber(phone, instanceId, tenantId) {
  const instance = await getInstanceForTenant(instanceId, tenantId);
  const clean = phone.replace(/\D/g, '');

  try {
    const result = await metaRequest({
      method: 'GET',
      path: `/whatsapp_availability?target_wa_id=${clean}`,
      accessToken: instance.resolved_token,
    });
    return { is_whatsapp: result.result === 'available', wa_id: clean };
  } catch {
    return { is_whatsapp: false, wa_id: null };
  }
}

module.exports = {
  sendTemplateMessage,
  sendTextMessage,
  markAsRead,
  submitTemplate,
  syncTemplateStatus,
  validateWhatsAppNumber,
  getInstanceForTenant,
  metaRequest,
};
