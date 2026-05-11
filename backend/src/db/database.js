require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});

/* ── Core query helpers ──────────────────────────────────────────────────── */

/** Retorna a primeira linha ou undefined */
async function one(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

/** Retorna todas as linhas */
async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/** Executa uma query e retorna o QueryResult completo */
async function run(sql, params = []) {
  return pool.query(sql, params);
}

/**
 * Executa uma função dentro de BEGIN/COMMIT/ROLLBACK.
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ── Settings helper ─────────────────────────────────────────────────────── */

/**
 * Busca um setting em system_settings; se vazio, tenta process.env[envKey].
 * @param {string} key
 * @param {string} [envKey]
 * @returns {Promise<string>}
 */
async function getSetting(key, envKey) {
  const row = await one('SELECT value FROM system_settings WHERE key = $1', [key]);
  const dbVal = row?.value;
  if (dbVal && dbVal.trim() !== '') return dbVal.trim();
  if (envKey) return process.env[envKey] || '';
  return '';
}

/* ── Schema ──────────────────────────────────────────────────────────────── */

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id               TEXT PRIMARY KEY,
      email            TEXT UNIQUE NOT NULL,
      password_hash    TEXT NOT NULL,
      name             TEXT NOT NULL DEFAULT 'Admin',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      email            TEXT UNIQUE NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active',
      credit_balance   NUMERIC(14,6) NOT NULL DEFAULT 0,
      plan             TEXT NOT NULL DEFAULT 'pay_as_you_go',
      anthropic_api_key TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id               TEXT PRIMARY KEY,
      tenant_id        TEXT NOT NULL REFERENCES tenants(id),
      email            TEXT UNIQUE NOT NULL,
      password_hash    TEXT NOT NULL,
      name             TEXT NOT NULL,
      role             TEXT NOT NULL DEFAULT 'owner',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_instances (
      id                    TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      waba_id               TEXT NOT NULL,
      phone_number_id       TEXT NOT NULL,
      access_token          TEXT NOT NULL,
      display_phone         TEXT,
      display_name          TEXT,
      webhook_verify_token  TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'active',
      tenant_id             TEXT REFERENCES tenants(id),
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_instances_tenant ON whatsapp_instances(tenant_id);

    CREATE TABLE IF NOT EXISTS pricing (
      resource_type    TEXT PRIMARY KEY,
      meta_base_cost   NUMERIC(14,6) NOT NULL DEFAULT 0,
      markup           NUMERIC(14,6) NOT NULL DEFAULT 0,
      description      TEXT,
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      description TEXT,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id                TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL REFERENCES tenants(id),
      amount            NUMERIC(14,6) NOT NULL,
      type              TEXT NOT NULL,
      description       TEXT,
      stripe_session_id TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL REFERENCES tenants(id),
      name         TEXT NOT NULL,
      key_hash     TEXT NOT NULL,
      key_prefix   TEXT NOT NULL,
      last_used_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lists (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL REFERENCES tenants(id),
      name          TEXT NOT NULL,
      columns       TEXT NOT NULL,
      phone_column  TEXT NOT NULL,
      country_code  TEXT NOT NULL DEFAULT '+55',
      contact_count INTEGER DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS list_contacts (
      id      TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      phone   TEXT NOT NULL,
      data    TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_lc_list_id ON list_contacts(list_id);

    CREATE TABLE IF NOT EXISTS segments (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL REFERENCES tenants(id),
      list_id       TEXT NOT NULL REFERENCES lists(id),
      name          TEXT NOT NULL,
      filters       TEXT NOT NULL DEFAULT '[]',
      contact_count INTEGER DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS templates (
      id               TEXT PRIMARY KEY,
      tenant_id        TEXT NOT NULL REFERENCES tenants(id),
      name             TEXT NOT NULL,
      category         TEXT NOT NULL DEFAULT 'MARKETING',
      language         TEXT NOT NULL DEFAULT 'pt_BR',
      meta_status      TEXT NOT NULL DEFAULT 'draft',
      meta_template_id TEXT,
      header_type      TEXT NOT NULL DEFAULT 'none',
      header_content   TEXT,
      body             TEXT NOT NULL,
      footer           TEXT,
      buttons          TEXT NOT NULL DEFAULT '[]',
      variables        TEXT NOT NULL DEFAULT '[]',
      rejection_reason TEXT,
      submitted_at     TIMESTAMPTZ,
      approved_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id               TEXT PRIMARY KEY,
      tenant_id        TEXT NOT NULL REFERENCES tenants(id),
      name             TEXT NOT NULL,
      list_id          TEXT NOT NULL REFERENCES lists(id),
      segment_id       TEXT REFERENCES segments(id),
      template_id      TEXT NOT NULL REFERENCES templates(id),
      instance_id      TEXT NOT NULL REFERENCES whatsapp_instances(id),
      variable_map     TEXT NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'draft',
      scheduled_at     TIMESTAMPTZ,
      total            INTEGER DEFAULT 0,
      sent             INTEGER DEFAULT 0,
      delivered        INTEGER DEFAULT 0,
      read_count       INTEGER DEFAULT 0,
      failed_count     INTEGER DEFAULT 0,
      total_cost       NUMERIC DEFAULT 0,
      cost_estimate    NUMERIC DEFAULT 0,
      opted_out_count  INTEGER DEFAULT 0,
      skipped_count    INTEGER DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      started_at       TIMESTAMPTZ,
      completed_at     TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS messages (
      id                TEXT PRIMARY KEY,
      campaign_id       TEXT NOT NULL REFERENCES campaigns(id),
      contact_id        TEXT NOT NULL REFERENCES list_contacts(id),
      phone             TEXT NOT NULL,
      template_id       TEXT,
      body              TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'queued',
      meta_message_id   TEXT,
      conversation_type TEXT,
      cost              NUMERIC,
      error_message     TEXT,
      sent_at           TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_msg_campaign ON messages(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_msg_meta     ON messages(meta_message_id);

    CREATE TABLE IF NOT EXISTS conversations (
      id                TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL REFERENCES tenants(id),
      instance_id       TEXT REFERENCES whatsapp_instances(id),
      contact_phone     TEXT NOT NULL,
      contact_name      TEXT,
      last_message_body TEXT,
      last_message_at   TIMESTAMPTZ,
      unread_count      INTEGER DEFAULT 0,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, instance_id, contact_phone)
    );

    CREATE INDEX IF NOT EXISTS idx_conv_tenant ON conversations(tenant_id);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL REFERENCES conversations(id),
      direction        TEXT NOT NULL,
      body             TEXT NOT NULL,
      message_type     TEXT NOT NULL DEFAULT 'text',
      media_url        TEXT,
      meta_message_id  TEXT,
      status           TEXT DEFAULT 'received',
      sent_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS optouts (
      id           TEXT PRIMARY KEY,
      phone        TEXT NOT NULL,
      tenant_id    TEXT,
      reason       TEXT DEFAULT 'opt_out',
      opted_out_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(phone, tenant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_optouts_phone ON optouts(phone);

    CREATE TABLE IF NOT EXISTS logs (
      id         TEXT PRIMARY KEY,
      tenant_id  TEXT,
      user_id    TEXT,
      level      TEXT NOT NULL DEFAULT 'info',
      category   TEXT NOT NULL,
      message    TEXT NOT NULL,
      metadata   TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_logs_tenant  ON logs(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

    CREATE TABLE IF NOT EXISTS whatsapp_validation (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL REFERENCES tenants(id),
      list_id      TEXT NOT NULL REFERENCES lists(id),
      contact_id   TEXT NOT NULL UNIQUE,
      phone        TEXT NOT NULL,
      is_whatsapp  BOOLEAN DEFAULT false,
      wa_id        TEXT,
      error        TEXT,
      validated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wv_list ON whatsapp_validation(list_id);

    CREATE TABLE IF NOT EXISTS orders (
      id                TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL REFERENCES tenants(id),
      stripe_session_id TEXT UNIQUE NOT NULL,
      amount_usd        NUMERIC NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      paid_at           TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
  `);

  /* ── Pricing defaults ──────────────────────────────────────────────────── */
  const pricingDefaults = [
    { resource_type: 'whatsapp_marketing',      meta_base_cost: 0.0625, markup: 0.02,   description: 'Conversa Marketing (iniciada pela empresa - promoções)' },
    { resource_type: 'whatsapp_utility',         meta_base_cost: 0.0080, markup: 0.005,  description: 'Conversa Utilitária (iniciada pela empresa - transacional)' },
    { resource_type: 'whatsapp_authentication',  meta_base_cost: 0.0315, markup: 0.01,   description: 'Conversa Autenticação (OTP, verificação)' },
    { resource_type: 'whatsapp_service',         meta_base_cost: 0.0000, markup: 0.005,  description: 'Conversa de Serviço (iniciada pelo usuário - atendimento)' },
    { resource_type: 'api_call',                 meta_base_cost: 0,      markup: 0.0001, description: 'Chamada de API' },
  ];
  for (const p of pricingDefaults) {
    await pool.query(
      `INSERT INTO pricing (resource_type, meta_base_cost, markup, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [p.resource_type, p.meta_base_cost, p.markup, p.description]
    );
  }

  /* ── Settings defaults ─────────────────────────────────────────────────── */
  const settingsDefaults = [
    { key: 'meta_app_id',                 value: '',                          description: 'Meta App ID (Facebook Developer App)' },
    { key: 'meta_app_secret',             value: '',                          description: 'Meta App Secret' },
    { key: 'meta_global_access_token',    value: '',                          description: 'Meta System User Access Token global (fallback se instância não tiver token próprio)' },
    { key: 'meta_webhook_verify_token',   value: '',                          description: 'Token de verificação global para webhooks Meta' },
    { key: 'meta_api_version',            value: 'v22.0',                     description: 'Versão da Meta Graph API (ex: v22.0)' },
    { key: 'stripe_secret_key',           value: '',                          description: 'Stripe Secret Key (sk_live_ ou sk_test_)' },
    { key: 'stripe_publishable_key',      value: '',                          description: 'Stripe Publishable Key (pk_live_ ou pk_test_)' },
    { key: 'stripe_webhook_secret',       value: '',                          description: 'Stripe Webhook Signing Secret (whsec_...)' },
    { key: 'billing_min_topup_usd',       value: '5',                         description: 'Valor mínimo de recarga em USD' },
    { key: 'billing_auto_suspend_usd',    value: '0',                         description: 'Suspender conta quando saldo < valor (0 = desativado)' },
    { key: 'billing_show_rates_to_users', value: '1',                         description: 'Mostrar tabela de tarifas para usuários (1=sim, 0=não)' },
    { key: 'anthropic_api_key',           value: '',                          description: 'Anthropic API Key global (sk-ant-...)' },
    { key: 'anthropic_model',             value: 'claude-haiku-4-5-20251001', description: 'Modelo Claude padrão' },
    { key: 'frontend_url',                value: 'http://localhost:5173',      description: 'URL pública do frontend (redirecionamento Stripe)' },
    { key: 'webhook_base_url',            value: '',                          description: 'URL base pública para webhooks (ex: https://api.meuapp.com)' },
  ];
  for (const s of settingsDefaults) {
    await pool.query(
      `INSERT INTO system_settings (key, value, description)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [s.key, s.value, s.description]
    );
  }

  console.log('✓ Database inicializado (PostgreSQL)');
}

module.exports = { pool, one, all, run, tx, getSetting, initDb };
