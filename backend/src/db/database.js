const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'maiver.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    credit_balance REAL NOT NULL DEFAULT 0,
    plan TEXT NOT NULL DEFAULT 'pay_as_you_go',
    twilio_account_sid TEXT,
    twilio_auth_token TEXT,
    twilio_messaging_service_sid TEXT,
    webhook_url TEXT,
    anthropic_api_key TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS pricing (
    resource_type TEXT PRIMARY KEY,
    twilio_base_cost REAL NOT NULL DEFAULT 0,
    markup REAL NOT NULL DEFAULT 0,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS credit_transactions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    stripe_session_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    columns TEXT NOT NULL,
    phone_column TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT '+55',
    contact_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS list_contacts (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (list_id) REFERENCES lists(id)
  );

  CREATE INDEX IF NOT EXISTS idx_lc_list_id ON list_contacts(list_id);

  CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    name TEXT NOT NULL,
    filters TEXT NOT NULL DEFAULT '[]',
    contact_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (list_id) REFERENCES lists(id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    variables TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    list_id TEXT NOT NULL,
    segment_id TEXT,
    template_id TEXT NOT NULL,
    variable_map TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    scheduled_at TEXT,
    total INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    delivered INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    cost_estimate REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (list_id) REFERENCES lists(id),
    FOREIGN KEY (template_id) REFERENCES templates(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    twilio_sid TEXT,
    cost REAL,
    error_message TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (contact_id) REFERENCES list_contacts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_msg_campaign ON messages(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_msg_twilio   ON messages(twilio_sid);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    contact_name TEXT,
    last_message_body TEXT,
    last_message_at TEXT,
    unread_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, contact_phone),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL,
    twilio_sid TEXT,
    status TEXT DEFAULT 'received',
    sent_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_conv_tenant ON conversations(tenant_id);

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    user_id TEXT,
    level TEXT NOT NULL DEFAULT 'info',
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_tenant  ON logs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

  CREATE TABLE IF NOT EXISTS lookup_results (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    contact_id TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    valid INTEGER DEFAULT 0,
    line_type TEXT,
    carrier TEXT,
    country_code TEXT,
    error TEXT,
    looked_up_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (list_id) REFERENCES lists(id)
  );

  CREATE INDEX IF NOT EXISTS idx_lookup_list ON lookup_results(list_id);

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    stripe_session_id TEXT UNIQUE NOT NULL,
    amount_usd REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);

  CREATE TABLE IF NOT EXISTS optouts (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    reason TEXT DEFAULT 'STOP',
    tenant_id TEXT,
    opted_out_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_optouts_phone ON optouts(phone);
`);

/* ── Migrations: add columns to existing tables ────────────────────────── */
const migrations = [
  'ALTER TABLE campaigns ADD COLUMN opted_out_count INTEGER DEFAULT 0',
  'ALTER TABLE campaigns ADD COLUMN skipped_count   INTEGER DEFAULT 0',
  'ALTER TABLE campaigns ADD COLUMN allowed_line_types TEXT DEFAULT NULL',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

/* ── Default pricing rows ──────────────────────────────────────────────── */
const pricingDefaults = [
  { resource_type: 'sms_outbound',  twilio_base_cost: 0.0079, markup: 0.005,  description: 'SMS Enviado' },
  { resource_type: 'sms_inbound',   twilio_base_cost: 0.0075, markup: 0.002,  description: 'SMS Recebido' },
  { resource_type: 'api_call',      twilio_base_cost: 0,      markup: 0.0001, description: 'Chamada de API' },
  { resource_type: 'phone_lookup',  twilio_base_cost: 0.005,  markup: 0.002,  description: 'Lookup de Telefone (validação + carrier)' },
];
for (const p of pricingDefaults) {
  db.prepare(
    'INSERT OR IGNORE INTO pricing (resource_type, twilio_base_cost, markup, description) VALUES (?, ?, ?, ?)'
  ).run(p.resource_type, p.twilio_base_cost, p.markup, p.description);
}

/* ── Default system settings ───────────────────────────────────────────── */
const settingsDefaults = [
  { key: 'twilio_account_sid',          value: '',  description: 'Twilio Account SID global' },
  { key: 'twilio_auth_token',           value: '',  description: 'Twilio Auth Token global' },
  { key: 'twilio_messaging_service_sid',value: '',  description: 'Twilio Messaging Service SID global' },
  { key: 'webhook_base_url',            value: '',  description: 'URL base pública para webhooks (ex: https://meu-servidor.com)' },
  { key: 'webhook_validate_signature',  value: '0', description: 'Validar assinatura Twilio nos webhooks (1=sim, 0=não)' },
  { key: 'stripe_secret_key',           value: '',  description: 'Stripe Secret Key (sk_live_ ou sk_test_)' },
  { key: 'stripe_publishable_key',      value: '',  description: 'Stripe Publishable Key (pk_live_ ou pk_test_)' },
  { key: 'stripe_webhook_secret',       value: '',  description: 'Stripe Webhook Signing Secret (whsec_...)' },
  { key: 'billing_min_topup_usd',       value: '5', description: 'Valor mínimo de recarga em USD' },
  { key: 'billing_auto_suspend_usd',    value: '0', description: 'Suspender conta automaticamente quando saldo < valor (0 = desativado)' },
  { key: 'billing_show_rates_to_users', value: '1', description: 'Mostrar tabela de tarifas para usuários (1=sim, 0=não)' },
  { key: 'anthropic_api_key',          value: '',  description: 'Anthropic API Key global (sk-ant-...)' },
  { key: 'anthropic_model',            value: 'claude-haiku-4-5-20251001', description: 'Modelo Claude padrão (claude-haiku-4-5-20251001, claude-sonnet-4-6, claude-opus-4-7)' },
  { key: 'frontend_url',               value: 'http://localhost:5173', description: 'URL pública do frontend (para redirecionamento Stripe)' },
];
for (const s of settingsDefaults) {
  db.prepare('INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?)').run(s.key, s.value, s.description);
}

/* ── Helper: get setting value ─────────────────────────────────────────── */
function getSetting(key, fallbackEnv) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  const dbVal = row?.value;
  if (dbVal && dbVal.trim() !== '') return dbVal.trim();
  if (fallbackEnv) return process.env[fallbackEnv] || '';
  return '';
}

module.exports = db;
module.exports.getSetting = getSetting;
