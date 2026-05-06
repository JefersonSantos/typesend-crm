-- =============================================================================
--  MAIVER — Reset completo + criação do schema
--  Execute no banco "maiver" no pgAdmin Query Tool
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PASSO 1: Remover tudo que existe (ordem inversa das FKs)
-- ---------------------------------------------------------------------------
DROP VIEW  IF EXISTS v_campaign_stats  CASCADE;
DROP VIEW  IF EXISTS v_tenant_summary  CASCADE;

DROP TABLE IF EXISTS logs                  CASCADE;
DROP TABLE IF EXISTS conversation_messages CASCADE;
DROP TABLE IF EXISTS conversations         CASCADE;
DROP TABLE IF EXISTS messages              CASCADE;
DROP TABLE IF EXISTS campaigns             CASCADE;
DROP TABLE IF EXISTS templates             CASCADE;
DROP TABLE IF EXISTS lookup_results        CASCADE;
DROP TABLE IF EXISTS segments              CASCADE;
DROP TABLE IF EXISTS list_contacts         CASCADE;
DROP TABLE IF EXISTS lists                 CASCADE;
DROP TABLE IF EXISTS orders                CASCADE;
DROP TABLE IF EXISTS credit_transactions   CASCADE;
DROP TABLE IF EXISTS api_keys              CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;
DROP TABLE IF EXISTS tenants               CASCADE;
DROP TABLE IF EXISTS pricing               CASCADE;
DROP TABLE IF EXISTS system_settings       CASCADE;
DROP TABLE IF EXISTS admin_users           CASCADE;

-- Remover tipos enumerados
DROP TYPE IF EXISTS tenant_status   CASCADE;
DROP TYPE IF EXISTS user_role       CASCADE;
DROP TYPE IF EXISTS campaign_status CASCADE;
DROP TYPE IF EXISTS message_status  CASCADE;
DROP TYPE IF EXISTS tx_type         CASCADE;
DROP TYPE IF EXISTS order_status    CASCADE;
DROP TYPE IF EXISTS log_level       CASCADE;
DROP TYPE IF EXISTS conv_direction  CASCADE;
DROP TYPE IF EXISTS line_type_enum  CASCADE;

-- Remover função de trigger
DROP FUNCTION IF EXISTS fn_set_updated_at CASCADE;

-- ---------------------------------------------------------------------------
-- PASSO 2: Recriar do zero
-- ---------------------------------------------------------------------------

-- TIPOS ENUMERADOS
CREATE TYPE tenant_status   AS ENUM ('active', 'suspended', 'blocked');
CREATE TYPE user_role       AS ENUM ('owner', 'admin', 'member');
CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'failed', 'cancelled');
CREATE TYPE message_status  AS ENUM ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received');
CREATE TYPE tx_type         AS ENUM ('topup', 'usage', 'manual_adjustment', 'manual_debit', 'refund');
CREATE TYPE order_status    AS ENUM ('pending', 'paid', 'failed', 'expired');
CREATE TYPE log_level       AS ENUM ('debug', 'info', 'warn', 'error');
CREATE TYPE conv_direction  AS ENUM ('inbound', 'outbound');
CREATE TYPE line_type_enum  AS ENUM ('mobile', 'landline', 'voip', 'unknown', 'nonFixedVoip', 'tollFree');

-- ---------------------------------------------------------------------------
-- ADMINISTRAÇÃO
-- ---------------------------------------------------------------------------
CREATE TABLE admin_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  name          TEXT        NOT NULL DEFAULT 'Admin',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_settings (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL DEFAULT '',
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pricing (
  resource_type    TEXT          PRIMARY KEY,
  twilio_base_cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  markup           NUMERIC(12,6) NOT NULL DEFAULT 0,
  description      TEXT,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pricing_costs CHECK (twilio_base_cost >= 0 AND markup >= 0)
);

-- ---------------------------------------------------------------------------
-- TENANTS
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id                           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                         TEXT          NOT NULL,
  email                        TEXT          NOT NULL UNIQUE,
  status                       tenant_status NOT NULL DEFAULT 'active',
  credit_balance               NUMERIC(14,6) NOT NULL DEFAULT 0,
  plan                         TEXT          NOT NULL DEFAULT 'pay_as_you_go',
  twilio_account_sid           TEXT,
  twilio_auth_token            TEXT,
  twilio_messaging_service_sid TEXT,
  webhook_url                  TEXT,
  anthropic_api_key            TEXT,
  created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tenant_balance CHECK (credit_balance >= -9999999)
);

CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_email  ON tenants(email);

-- ---------------------------------------------------------------------------
-- USUÁRIOS
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'owner',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email  ON users(email);

-- ---------------------------------------------------------------------------
-- API KEYS
-- ---------------------------------------------------------------------------
CREATE TABLE api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_hash   ON api_keys(key_hash);

-- ---------------------------------------------------------------------------
-- BILLING
-- ---------------------------------------------------------------------------
CREATE TABLE credit_transactions (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount            NUMERIC(14,6) NOT NULL,
  type              tx_type       NOT NULL,
  description       TEXT,
  stripe_session_id TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_tx_tenant  ON credit_transactions(tenant_id);
CREATE INDEX idx_credit_tx_created ON credit_transactions(created_at DESC);
CREATE INDEX idx_credit_tx_stripe  ON credit_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE TABLE orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_session_id TEXT          NOT NULL UNIQUE,
  amount_usd        NUMERIC(12,4) NOT NULL,
  status            order_status  NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ,
  CONSTRAINT chk_order_amount CHECK (amount_usd > 0)
);

CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_stripe ON orders(stripe_session_id);

-- ---------------------------------------------------------------------------
-- LISTAS DE CONTATOS
-- ---------------------------------------------------------------------------
CREATE TABLE lists (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  columns       JSONB       NOT NULL DEFAULT '[]',
  phone_column  TEXT        NOT NULL,
  country_code  TEXT        NOT NULL DEFAULT '+55',
  contact_count INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lists_tenant ON lists(tenant_id);

CREATE TABLE list_contacts (
  id      UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID  NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  phone   TEXT  NOT NULL,
  data    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_lc_list_id ON list_contacts(list_id);
CREATE INDEX idx_lc_phone   ON list_contacts(phone);

CREATE TABLE segments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id       UUID        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  filters       JSONB       NOT NULL DEFAULT '[]',
  contact_count INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_segments_tenant ON segments(tenant_id);
CREATE INDEX idx_segments_list   ON segments(list_id);

CREATE TABLE lookup_results (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id      UUID        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  contact_id   UUID        NOT NULL UNIQUE REFERENCES list_contacts(id) ON DELETE CASCADE,
  phone        TEXT        NOT NULL,
  valid        BOOLEAN     NOT NULL DEFAULT FALSE,
  line_type    TEXT,
  carrier      TEXT,
  country_code TEXT,
  error        TEXT,
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lookup_list      ON lookup_results(list_id);
CREATE INDEX idx_lookup_tenant    ON lookup_results(tenant_id);
CREATE INDEX idx_lookup_line_type ON lookup_results(line_type);
CREATE INDEX idx_lookup_valid     ON lookup_results(valid);

-- ---------------------------------------------------------------------------
-- TEMPLATES
-- ---------------------------------------------------------------------------
CREATE TABLE templates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  variables  JSONB       NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_tenant ON templates(tenant_id);

-- ---------------------------------------------------------------------------
-- CAMPANHAS
-- ---------------------------------------------------------------------------
CREATE TABLE campaigns (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT            NOT NULL,
  list_id       UUID            NOT NULL REFERENCES lists(id),
  segment_id    UUID            REFERENCES segments(id),
  template_id   UUID            NOT NULL REFERENCES templates(id),
  variable_map  JSONB           NOT NULL DEFAULT '{}',
  status        campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at  TIMESTAMPTZ,
  total         INTEGER         NOT NULL DEFAULT 0,
  sent          INTEGER         NOT NULL DEFAULT 0,
  delivered     INTEGER         NOT NULL DEFAULT 0,
  failed_count  INTEGER         NOT NULL DEFAULT 0,
  total_cost    NUMERIC(14,6)   NOT NULL DEFAULT 0,
  cost_estimate NUMERIC(14,6)   NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  CONSTRAINT chk_campaign_counts CHECK (total >= 0 AND sent >= 0 AND delivered >= 0 AND failed_count >= 0)
);

CREATE INDEX idx_campaigns_tenant    ON campaigns(tenant_id);
CREATE INDEX idx_campaigns_status    ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled ON campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_campaigns_created   ON campaigns(created_at DESC);

-- ---------------------------------------------------------------------------
-- MENSAGENS
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID           NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    UUID           NOT NULL REFERENCES list_contacts(id),
  phone         TEXT           NOT NULL,
  body          TEXT           NOT NULL,
  status        message_status NOT NULL DEFAULT 'queued',
  twilio_sid    TEXT,
  cost          NUMERIC(12,6),
  error_message TEXT,
  sent_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_campaign    ON messages(campaign_id);
CREATE INDEX idx_messages_twilio_sid  ON messages(twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX idx_messages_status      ON messages(status);
CREATE INDEX idx_messages_camp_status ON messages(campaign_id, status);

-- ---------------------------------------------------------------------------
-- CONVERSAS (Chat Inbound)
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_phone     TEXT        NOT NULL,
  contact_name      TEXT,
  last_message_body TEXT,
  last_message_at   TIMESTAMPTZ,
  unread_count      INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, contact_phone)
);

CREATE INDEX idx_conv_tenant       ON conversations(tenant_id);
CREATE INDEX idx_conv_last_message ON conversations(tenant_id, last_message_at DESC);

CREATE TABLE conversation_messages (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID           NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       conv_direction NOT NULL,
  body            TEXT           NOT NULL,
  twilio_sid      TEXT,
  status          message_status NOT NULL DEFAULT 'received',
  sent_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conv_messages_conv ON conversation_messages(conversation_id);
CREATE INDEX idx_conv_messages_sent ON conversation_messages(conversation_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- LOGS
-- ---------------------------------------------------------------------------
CREATE TABLE logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  level      log_level   NOT NULL DEFAULT 'info',
  category   TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_logs_tenant   ON logs(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_logs_level    ON logs(level);
CREATE INDEX idx_logs_category ON logs(category);
CREATE INDEX idx_logs_created  ON logs(created_at DESC);
CREATE INDEX idx_logs_brin     ON logs USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- TRIGGER updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_users_upd    BEFORE UPDATE ON admin_users           FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_tenants_upd        BEFORE UPDATE ON tenants               FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_users_upd          BEFORE UPDATE ON users                 FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_templates_upd      BEFORE UPDATE ON templates             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_conversations_upd  BEFORE UPDATE ON conversations         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_system_settings_upd BEFORE UPDATE ON system_settings      FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_pricing_upd        BEFORE UPDATE ON pricing               FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_messages_upd       BEFORE UPDATE ON messages              FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_tenant_summary AS
SELECT
  t.id, t.name, t.email, t.status, t.plan, t.credit_balance, t.created_at,
  COUNT(DISTINCT u.id)                                                          AS user_count,
  COUNT(DISTINCT c.id)                                                          AS campaign_count,
  COUNT(DISTINCT m.id)                                                          AS message_count,
  COALESCE(SUM(ct.amount) FILTER (WHERE ct.type = 'topup'),         0)         AS total_topup,
  COALESCE(ABS(SUM(ct.amount) FILTER (WHERE ct.type = 'usage')),    0)         AS total_spent,
  (t.twilio_account_sid IS NOT NULL)                                            AS has_custom_twilio,
  (t.anthropic_api_key  IS NOT NULL)                                            AS has_custom_ai
FROM tenants t
LEFT JOIN users               u  ON u.tenant_id   = t.id
LEFT JOIN campaigns           c  ON c.tenant_id   = t.id
LEFT JOIN messages            m  ON m.campaign_id = c.id
LEFT JOIN credit_transactions ct ON ct.tenant_id  = t.id
GROUP BY t.id;

CREATE OR REPLACE VIEW v_campaign_stats AS
SELECT
  c.*,
  ROUND(CASE WHEN c.sent > 0 THEN (c.delivered::NUMERIC / c.sent * 100) ELSE 0 END, 2) AS delivery_rate_pct,
  EXTRACT(EPOCH FROM (c.completed_at - c.started_at))                                   AS duration_seconds,
  l.name   AS list_name,
  tpl.name AS template_name,
  s.name   AS segment_name
FROM campaigns c
LEFT JOIN lists     l   ON l.id   = c.list_id
LEFT JOIN templates tpl ON tpl.id = c.template_id
LEFT JOIN segments  s   ON s.id   = c.segment_id;

-- ---------------------------------------------------------------------------
-- DADOS INICIAIS — Pricing
-- ---------------------------------------------------------------------------
INSERT INTO pricing (resource_type, twilio_base_cost, markup, description) VALUES
  ('sms_outbound', 0.007900, 0.005000, 'SMS Enviado (por segmento de 160 chars GSM-7 / 70 chars Unicode)'),
  ('sms_inbound',  0.007500, 0.002000, 'SMS Recebido (inbound)'),
  ('phone_lookup', 0.005000, 0.002000, 'Lookup de Telefone — validação, tipo de linha e operadora (Twilio Lookup V2)'),
  ('api_call',     0.000000, 0.000100, 'Chamada de API externa');

-- ---------------------------------------------------------------------------
-- DADOS INICIAIS — System Settings
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (key, value, description) VALUES
  ('twilio_account_sid',           '',                         'Twilio Account SID global (ACxxxxxxxx)'),
  ('twilio_auth_token',            '',                         'Twilio Auth Token global'),
  ('twilio_messaging_service_sid', '',                         'Twilio Messaging Service SID global (MGxxxxxxxx)'),
  ('webhook_base_url',             '',                         'URL base pública para webhooks (ex: https://api.meusite.com)'),
  ('webhook_validate_signature',   '0',                        'Validar assinatura HMAC Twilio nos webhooks (1=sim, 0=não)'),
  ('stripe_secret_key',            '',                         'Stripe Secret Key (sk_live_... ou sk_test_...)'),
  ('stripe_publishable_key',       '',                         'Stripe Publishable Key (pk_live_... ou pk_test_...)'),
  ('stripe_webhook_secret',        '',                         'Stripe Webhook Signing Secret (whsec_...)'),
  ('billing_min_topup_usd',        '5',                        'Valor mínimo de recarga em USD'),
  ('billing_auto_suspend_usd',     '0',                        'Suspender conta quando saldo < valor em USD (0 = desativado)'),
  ('billing_show_rates_to_users',  '1',                        'Exibir tabela de tarifas para usuários finais (1=sim, 0=não)'),
  ('anthropic_api_key',            '',                         'Anthropic API Key global (sk-ant-...)'),
  ('anthropic_model',              'claude-haiku-4-5-20251001','Modelo Claude padrão'),
  ('frontend_url',                 'http://localhost:5173',    'URL pública do frontend (redirects Stripe)');

-- ---------------------------------------------------------------------------
-- VERIFICAÇÃO FINAL
-- ---------------------------------------------------------------------------
SELECT
  tablename                                                              AS tabela,
  pg_size_pretty(pg_total_relation_size(quote_ident(tablename)))        AS tamanho
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
