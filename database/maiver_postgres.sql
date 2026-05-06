-- =============================================================================
--  MAIVER SMS CRM — PostgreSQL Schema
--  Arquitetura Multitenant
--  Versão: 2.0
--  Gerado em: 2026-05-06
-- =============================================================================
--
--  USO:
--    psql -U postgres -d maiver -f maiver_postgres.sql
--
--  Ou para criar o banco do zero:
--    psql -U postgres -c "CREATE DATABASE maiver ENCODING 'UTF8' LC_COLLATE 'pt_BR.UTF-8' LC_CTYPE 'pt_BR.UTF-8' TEMPLATE template0;"
--    psql -U postgres -d maiver -f maiver_postgres.sql
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSÕES
-- ---------------------------------------------------------------------------
-- uuid-ossp: gen_random_uuid() já está disponível no PG 13+ sem extensão.
-- Para PG < 13 ou para uuid_generate_v4() descomente:
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pgcrypto não é necessário no PG 13+, mas útil para funções de hash
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS (Enums)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE tenant_status   AS ENUM ('active', 'suspended', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role       AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_status  AS ENUM ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tx_type         AS ENUM ('topup', 'usage', 'manual_adjustment', 'manual_debit', 'refund');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status    AS ENUM ('pending', 'paid', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE log_level       AS ENUM ('debug', 'info', 'warn', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conv_direction  AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE line_type_enum  AS ENUM ('mobile', 'landline', 'voip', 'unknown', 'nonFixedVoip', 'tollFree');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. ADMINISTRAÇÃO DO SISTEMA
-- ---------------------------------------------------------------------------

-- Usuários administradores da plataforma (super-admins, não ligados a tenants)
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  name          TEXT        NOT NULL DEFAULT 'Admin',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  admin_users               IS 'Super-administradores da plataforma Maiver';
COMMENT ON COLUMN admin_users.id            IS 'UUID único do admin';
COMMENT ON COLUMN admin_users.email         IS 'Email de login (único na plataforma)';
COMMENT ON COLUMN admin_users.password_hash IS 'Hash bcrypt da senha';

-- Configurações globais do sistema (chave-valor)
CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL DEFAULT '',
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  system_settings             IS 'Configurações globais editáveis pelo admin (Twilio, Stripe, IA, billing)';
COMMENT ON COLUMN system_settings.key         IS 'Chave única da configuração';
COMMENT ON COLUMN system_settings.value       IS 'Valor em texto (senhas são criptografadas na aplicação)';

-- Tabela de preços por recurso (editável pelo admin)
CREATE TABLE IF NOT EXISTS pricing (
  resource_type    TEXT           PRIMARY KEY,
  twilio_base_cost NUMERIC(12,6)  NOT NULL DEFAULT 0,
  markup           NUMERIC(12,6)  NOT NULL DEFAULT 0,
  description      TEXT,
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pricing_costs CHECK (twilio_base_cost >= 0 AND markup >= 0)
);

COMMENT ON TABLE  pricing                   IS 'Tabela de preços por tipo de recurso — editável pelo admin';
COMMENT ON COLUMN pricing.resource_type     IS 'Identificador do recurso: sms_outbound, sms_inbound, phone_lookup, api_call';
COMMENT ON COLUMN pricing.twilio_base_cost  IS 'Custo cobrado pelo Twilio por unidade (USD)';
COMMENT ON COLUMN pricing.markup            IS 'Markup adicional da plataforma por unidade (USD)';

-- ---------------------------------------------------------------------------
-- 3. TENANTS (Contas de cliente)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id                           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                         TEXT          NOT NULL,
  email                        TEXT          NOT NULL UNIQUE,
  status                       tenant_status NOT NULL DEFAULT 'active',
  credit_balance               NUMERIC(14,6) NOT NULL DEFAULT 0,
  plan                         TEXT          NOT NULL DEFAULT 'pay_as_you_go',

  -- Credenciais Twilio dedicadas (subconta) — NULL = usar global
  twilio_account_sid           TEXT,
  twilio_auth_token            TEXT,          -- Armazenar criptografado em produção
  twilio_messaging_service_sid TEXT,
  webhook_url                  TEXT,

  -- IA por tenant — NULL = usar chave global
  anthropic_api_key            TEXT,          -- Armazenar criptografado em produção

  -- Metadados
  created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_tenant_balance CHECK (credit_balance >= -9999999)
);

COMMENT ON TABLE  tenants                            IS 'Empresas clientes da plataforma (modelo multitenant)';
COMMENT ON COLUMN tenants.credit_balance             IS 'Saldo em USD — debitado a cada campanha enviada';
COMMENT ON COLUMN tenants.twilio_account_sid         IS 'SID da subconta Twilio dedicada. NULL = usa configuração global';
COMMENT ON COLUMN tenants.twilio_auth_token          IS 'Auth token da subconta — deve ser cifrado em produção (AES-256)';
COMMENT ON COLUMN tenants.anthropic_api_key          IS 'API Key Anthropic própria do tenant — deve ser cifrada em produção';

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_email  ON tenants(email);

-- ---------------------------------------------------------------------------
-- 4. USUÁRIOS DOS TENANTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
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

COMMENT ON TABLE  users           IS 'Usuários vinculados a um tenant — podem ter roles: owner, admin, member';
COMMENT ON COLUMN users.role      IS 'owner: dono da conta | admin: admin do tenant | member: somente leitura';
COMMENT ON COLUMN users.tenant_id IS 'FK para tenants — exclusão em cascata';

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);

-- ---------------------------------------------------------------------------
-- 5. API KEYS DOS TENANTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  key_hash    TEXT        NOT NULL UNIQUE,  -- SHA-256 da chave completa
  key_prefix  TEXT        NOT NULL,         -- Primeiros 8 chars para identificação (ex: mvr_1a2b...)
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  api_keys           IS 'Chaves de API por tenant para integração programática';
COMMENT ON COLUMN api_keys.key_hash  IS 'Hash SHA-256 da chave — a chave bruta nunca é armazenada';
COMMENT ON COLUMN api_keys.key_prefix IS 'Prefixo visível para o usuário identificar a chave (mvr_XXXXXXXX)';

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant   ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash     ON api_keys(key_hash);

-- ---------------------------------------------------------------------------
-- 6. BILLING — Transações e Ordens de Pagamento
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount            NUMERIC(14,6) NOT NULL,   -- Positivo = crédito, negativo = débito
  type              tx_type     NOT NULL,
  description       TEXT,
  stripe_session_id TEXT,                     -- Referência ao Stripe Checkout Session
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  credit_transactions                  IS 'Histórico completo de movimentações de crédito por tenant';
COMMENT ON COLUMN credit_transactions.amount           IS 'Valor em USD — positivo para entradas, negativo para saídas';
COMMENT ON COLUMN credit_transactions.stripe_session_id IS 'ID da sessão Stripe vinculada (somente para type=topup)';

CREATE INDEX IF NOT EXISTS idx_credit_tx_tenant     ON credit_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_created    ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_stripe     ON credit_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Ordens de pagamento Stripe com ciclo de vida
CREATE TABLE IF NOT EXISTS orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_session_id TEXT          NOT NULL UNIQUE,
  amount_usd        NUMERIC(12,4) NOT NULL,
  status            order_status  NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ,

  CONSTRAINT chk_order_amount CHECK (amount_usd > 0),
  CONSTRAINT chk_order_paid   CHECK (
    (status = 'paid' AND paid_at IS NOT NULL) OR
    (status != 'paid' AND paid_at IS NULL) OR
    (status = 'paid')  -- Permite paid sem paid_at em edge cases
  )
);

COMMENT ON TABLE  orders                   IS 'Ordens de pagamento Stripe — rastreia ciclo pending → paid/failed/expired';
COMMENT ON COLUMN orders.stripe_session_id IS 'ID único da Stripe Checkout Session';
COMMENT ON COLUMN orders.paid_at           IS 'Timestamp de confirmação do pagamento via webhook Stripe';

CREATE INDEX IF NOT EXISTS idx_orders_tenant  ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_stripe  ON orders(stripe_session_id);

-- ---------------------------------------------------------------------------
-- 7. LISTAS DE CONTATOS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lists (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  columns       JSONB       NOT NULL DEFAULT '[]',      -- Array de strings com nomes das colunas
  phone_column  TEXT        NOT NULL,
  country_code  TEXT        NOT NULL DEFAULT '+55',
  contact_count INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  lists               IS 'Listas de contatos importadas via CSV por tenant';
COMMENT ON COLUMN lists.columns       IS 'Array JSON com os nomes de todas as colunas da lista';
COMMENT ON COLUMN lists.phone_column  IS 'Nome da coluna que contém o telefone';
COMMENT ON COLUMN lists.country_code  IS 'Código do país padrão para normalização (ex: +55)';
COMMENT ON COLUMN lists.contact_count IS 'Contador desnormalizado — atualizado após imports e deleções';

CREATE INDEX IF NOT EXISTS idx_lists_tenant ON lists(tenant_id);

-- Contatos individuais de cada lista
CREATE TABLE IF NOT EXISTS list_contacts (
  id      UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID   NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  phone   TEXT   NOT NULL,        -- Número normalizado (ex: +5511999999999)
  data    JSONB  NOT NULL DEFAULT '{}'  -- Dados originais do CSV para uso em templates
);

COMMENT ON TABLE  list_contacts      IS 'Contatos individuais — um registro por linha do CSV importado';
COMMENT ON COLUMN list_contacts.phone IS 'Número E.164 normalizado (ex: +5511999999999)';
COMMENT ON COLUMN list_contacts.data  IS 'Dados completos da linha CSV em JSONB para uso nas variáveis do template';

CREATE INDEX IF NOT EXISTS idx_lc_list_id ON list_contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_lc_phone   ON list_contacts(phone);

-- Segmentos filtrados de uma lista
CREATE TABLE IF NOT EXISTS segments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id       UUID        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  filters       JSONB       NOT NULL DEFAULT '[]',   -- Array de filtros: [{column, op, value}]
  contact_count INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  segments          IS 'Segmentos filtrados de uma lista — define subconjunto para campanhas';
COMMENT ON COLUMN segments.filters  IS 'Array de filtros JSONB: [{column, op: contains|equals|starts_with|not_empty, value}]';

CREATE INDEX IF NOT EXISTS idx_segments_tenant  ON segments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_segments_list    ON segments(list_id);

-- Resultados de Phone Lookup (Twilio Lookup V2)
CREATE TABLE IF NOT EXISTS lookup_results (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id      UUID           NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  contact_id   UUID           NOT NULL UNIQUE REFERENCES list_contacts(id) ON DELETE CASCADE,
  phone        TEXT           NOT NULL,
  valid        BOOLEAN        NOT NULL DEFAULT FALSE,
  line_type    TEXT,          -- mobile, landline, voip, unknown, nonFixedVoip, tollFree
  carrier      TEXT,          -- Nome da operadora
  country_code TEXT,          -- Código ISO do país (ex: BR)
  error        TEXT,          -- Mensagem de erro se lookup falhou
  looked_up_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  lookup_results             IS 'Resultados do Twilio Lookup V2 por contato — 1 resultado por contato';
COMMENT ON COLUMN lookup_results.valid       IS 'Número válido e acessível segundo Twilio';
COMMENT ON COLUMN lookup_results.line_type   IS 'Tipo de linha: mobile, landline, voip, nonFixedVoip, tollFree, unknown';
COMMENT ON COLUMN lookup_results.carrier     IS 'Nome da operadora retornado pelo Twilio';
COMMENT ON COLUMN lookup_results.country_code IS 'Código ISO2 do país (BR, US, PT...)';

CREATE INDEX IF NOT EXISTS idx_lookup_list       ON lookup_results(list_id);
CREATE INDEX IF NOT EXISTS idx_lookup_tenant     ON lookup_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lookup_line_type  ON lookup_results(line_type);
CREATE INDEX IF NOT EXISTS idx_lookup_valid      ON lookup_results(valid);

-- ---------------------------------------------------------------------------
-- 8. TEMPLATES DE MENSAGEM
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS templates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  variables  JSONB       NOT NULL DEFAULT '[]',   -- Array de strings: ["nome", "cidade"]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  templates           IS 'Templates de SMS com suporte a variáveis {{variavel}}';
COMMENT ON COLUMN templates.variables IS 'Array JSONB com nomes das variáveis detectadas no body';

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates(tenant_id);

-- ---------------------------------------------------------------------------
-- 9. CAMPANHAS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT            NOT NULL,
  list_id       UUID            NOT NULL REFERENCES lists(id),
  segment_id    UUID            REFERENCES segments(id),
  template_id   UUID            NOT NULL REFERENCES templates(id),
  variable_map  JSONB           NOT NULL DEFAULT '{}',   -- Mapeamento coluna → variável do template
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

  CONSTRAINT chk_campaign_counts CHECK (
    total >= 0 AND sent >= 0 AND delivered >= 0 AND failed_count >= 0
  )
);

COMMENT ON TABLE  campaigns               IS 'Campanhas de SMS — agrega configuração, progresso e custos';
COMMENT ON COLUMN campaigns.variable_map  IS 'JSONB mapeando variáveis do template para colunas da lista: {"nome": "Nome_Coluna"}';
COMMENT ON COLUMN campaigns.cost_estimate IS 'Estimativa de custo calculada antes do envio (USD)';
COMMENT ON COLUMN campaigns.total_cost    IS 'Custo real acumulado após o envio (USD)';

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant      ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status      ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled   ON campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_created     ON campaigns(created_at DESC);

-- ---------------------------------------------------------------------------
-- 10. MENSAGENS (Registros individuais de envio)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID           NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    UUID           NOT NULL REFERENCES list_contacts(id),
  phone         TEXT           NOT NULL,
  body          TEXT           NOT NULL,
  status        message_status NOT NULL DEFAULT 'queued',
  twilio_sid    TEXT,          -- SID da mensagem no Twilio (ex: SMxxxxxx)
  cost          NUMERIC(12,6), -- Custo real reportado pelo Twilio via webhook
  error_message TEXT,
  sent_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  messages             IS 'Registro individual de cada SMS enviado — atualizado via webhook Twilio';
COMMENT ON COLUMN messages.twilio_sid  IS 'SID retornado pelo Twilio — usado para correlacionar webhooks de status';
COMMENT ON COLUMN messages.cost        IS 'Custo real em USD reportado pelo Twilio no webhook de status';

CREATE INDEX IF NOT EXISTS idx_messages_campaign   ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_twilio_sid ON messages(twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_status     ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_phone      ON messages(phone);
-- Índice composto para queries de histórico filtradas por campanha + status
CREATE INDEX IF NOT EXISTS idx_messages_camp_status ON messages(campaign_id, status);

-- ---------------------------------------------------------------------------
-- 11. CONVERSAS (Chat — SMS Inbound)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_phone     TEXT        NOT NULL,
  contact_name      TEXT,
  last_message_body TEXT,
  last_message_at   TIMESTAMPTZ,
  unread_count      INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, contact_phone)    -- Um fio de conversa por número por tenant
);

COMMENT ON TABLE  conversations               IS 'Fios de conversa de SMS bidirecional por contato por tenant';
COMMENT ON COLUMN conversations.unread_count  IS 'Contador de mensagens inbound não lidas — zerado ao abrir a conversa';

CREATE INDEX IF NOT EXISTS idx_conv_tenant          ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conv_last_message    ON conversations(tenant_id, last_message_at DESC);

-- Mensagens dentro de cada conversa
CREATE TABLE IF NOT EXISTS conversation_messages (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       conv_direction NOT NULL,
  body            TEXT          NOT NULL,
  twilio_sid      TEXT,
  status          message_status NOT NULL DEFAULT 'received',
  sent_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  conversation_messages            IS 'Mensagens individuais dentro de um fio de conversa';
COMMENT ON COLUMN conversation_messages.direction  IS 'inbound = recebida do contato | outbound = enviada pela plataforma';

CREATE INDEX IF NOT EXISTS idx_conv_messages_conv  ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_messages_sent  ON conversation_messages(conversation_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- 12. LOGS DO SISTEMA
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        REFERENCES tenants(id) ON DELETE SET NULL,  -- NULL = log de sistema
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  level      log_level   NOT NULL DEFAULT 'info',
  category   TEXT        NOT NULL,   -- Ex: 'campaign', 'billing', 'lookup', 'auth', 'webhook'
  message    TEXT        NOT NULL,
  metadata   JSONB,                  -- Dados adicionais estruturados
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  logs           IS 'Log de auditoria e eventos do sistema — admin vê tudo, tenant vê apenas os seus';
COMMENT ON COLUMN logs.tenant_id IS 'NULL indica log global de sistema (sem tenant associado)';
COMMENT ON COLUMN logs.category  IS 'Categoria funcional: auth, campaign, billing, lookup, webhook, system';
COMMENT ON COLUMN logs.metadata  IS 'Dados adicionais em JSONB: IDs, valores, contexto do evento';

CREATE INDEX IF NOT EXISTS idx_logs_tenant   ON logs(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_level    ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_created  ON logs(created_at DESC);
-- Índice para expiração automática (útil com pg_partman ou cron de limpeza)
CREATE INDEX IF NOT EXISTS idx_logs_created_brin ON logs USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- 13. FUNÇÃO — Atualizar updated_at automaticamente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
DO $$ BEGIN
  CREATE TRIGGER trg_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_pricing_updated_at
    BEFORE UPDATE ON pricing
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 14. DADOS INICIAIS — Pricing
-- ---------------------------------------------------------------------------

INSERT INTO pricing (resource_type, twilio_base_cost, markup, description) VALUES
  ('sms_outbound', 0.007900, 0.005000, 'SMS Enviado (por segmento de 160 chars GSM-7 / 70 chars Unicode)'),
  ('sms_inbound',  0.007500, 0.002000, 'SMS Recebido (inbound)'),
  ('phone_lookup', 0.005000, 0.002000, 'Lookup de Telefone — validação, tipo de linha e operadora (Twilio Lookup V2)'),
  ('api_call',     0.000000, 0.000100, 'Chamada de API externa')
ON CONFLICT (resource_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 15. DADOS INICIAIS — System Settings
-- ---------------------------------------------------------------------------

INSERT INTO system_settings (key, value, description) VALUES
  -- Twilio Global
  ('twilio_account_sid',           '',                        'Twilio Account SID global (ACxxxxxxxx)'),
  ('twilio_auth_token',            '',                        'Twilio Auth Token global — armazenar cifrado'),
  ('twilio_messaging_service_sid', '',                        'Twilio Messaging Service SID global (MGxxxxxxxx)'),
  ('webhook_base_url',             '',                        'URL base pública para receber webhooks (ex: https://api.meusite.com)'),
  ('webhook_validate_signature',   '0',                       'Validar assinatura HMAC do Twilio nos webhooks (1=sim, 0=não)'),
  -- Stripe
  ('stripe_secret_key',            '',                        'Stripe Secret Key (sk_live_... ou sk_test_...)'),
  ('stripe_publishable_key',       '',                        'Stripe Publishable Key (pk_live_... ou pk_test_...)'),
  ('stripe_webhook_secret',        '',                        'Stripe Webhook Signing Secret (whsec_...)'),
  -- Billing
  ('billing_min_topup_usd',        '5',                       'Valor mínimo de recarga em USD'),
  ('billing_auto_suspend_usd',     '0',                       'Suspender conta quando saldo < valor em USD (0 = desativado)'),
  ('billing_show_rates_to_users',  '1',                       'Exibir tabela de tarifas para usuários finais (1=sim, 0=não)'),
  -- IA / Anthropic
  ('anthropic_api_key',            '',                        'Anthropic API Key global (sk-ant-...) — armazenar cifrado'),
  ('anthropic_model',              'claude-haiku-4-5-20251001','Modelo Claude padrão para geração de copy SMS'),
  -- Frontend
  ('frontend_url',                 'http://localhost:5173',   'URL pública do frontend (usado em redirects do Stripe)')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 16. VIEW — Resumo de tenants (útil para dashboard admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_tenant_summary AS
SELECT
  t.id,
  t.name,
  t.email,
  t.status,
  t.plan,
  t.credit_balance,
  t.created_at,
  COUNT(DISTINCT u.id)              AS user_count,
  COUNT(DISTINCT c.id)              AS campaign_count,
  COUNT(DISTINCT m.id)              AS message_count,
  COALESCE(SUM(ct.amount) FILTER (WHERE ct.type = 'topup'), 0)          AS total_topup,
  COALESCE(ABS(SUM(ct.amount) FILTER (WHERE ct.type = 'usage')), 0)     AS total_spent,
  CASE WHEN t.twilio_account_sid IS NOT NULL THEN TRUE ELSE FALSE END    AS has_custom_twilio,
  CASE WHEN t.anthropic_api_key  IS NOT NULL THEN TRUE ELSE FALSE END    AS has_custom_ai
FROM tenants t
LEFT JOIN users              u  ON u.tenant_id  = t.id
LEFT JOIN campaigns          c  ON c.tenant_id  = t.id
LEFT JOIN messages           m  ON m.campaign_id = c.id
LEFT JOIN credit_transactions ct ON ct.tenant_id = t.id
GROUP BY t.id;

COMMENT ON VIEW v_tenant_summary IS 'Visão consolidada de métricas por tenant — usada no dashboard admin';

-- ---------------------------------------------------------------------------
-- 17. VIEW — Estatísticas de campanhas por tenant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_campaign_stats AS
SELECT
  c.id,
  c.tenant_id,
  c.name,
  c.status,
  c.total,
  c.sent,
  c.delivered,
  c.failed_count,
  c.cost_estimate,
  c.total_cost,
  c.created_at,
  c.started_at,
  c.completed_at,
  ROUND(
    CASE WHEN c.sent > 0
         THEN (c.delivered::NUMERIC / c.sent * 100)
         ELSE 0
    END, 2
  ) AS delivery_rate_pct,
  EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) AS duration_seconds,
  l.name  AS list_name,
  tpl.name AS template_name,
  s.name   AS segment_name
FROM campaigns c
LEFT JOIN lists     l   ON l.id = c.list_id
LEFT JOIN templates tpl ON tpl.id = c.template_id
LEFT JOIN segments  s   ON s.id = c.segment_id;

COMMENT ON VIEW v_campaign_stats IS 'Estatísticas completas de campanhas incluindo taxa de entrega e duração';

-- ---------------------------------------------------------------------------
-- 18. ROW LEVEL SECURITY (RLS) — Isolamento multitenant
--     Descomentado quando a aplicação passar a usar o Postgres com usuário
--     de conexão por tenant (ou com SET app.current_tenant_id = '...' no pool).
-- ---------------------------------------------------------------------------

/*
-- Habilitar RLS nas tabelas de dados de tenant
ALTER TABLE lists               ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lookup_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys             ENABLE ROW LEVEL SECURITY;

-- Exemplo de policy usando variável de sessão definida pela aplicação:
-- SET app.current_tenant_id = '<uuid>' — definido no connection pool ao autenticar

CREATE POLICY tenant_isolation ON lists
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY tenant_isolation ON campaigns
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- (Repetir para cada tabela com tenant_id)
*/

-- ---------------------------------------------------------------------------
-- 19. MANUTENÇÃO — Limpeza automática de logs antigos (opcional)
--     Execute via pg_cron ou job externo
-- ---------------------------------------------------------------------------

/*
-- Instalar pg_cron (requer superusuário):
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Apagar logs de mais de 90 dias toda madrugada às 3h
SELECT cron.schedule(
  'cleanup_old_logs',
  '0 3 * * *',
  $$DELETE FROM logs WHERE created_at < NOW() - INTERVAL '90 days'$$
);
*/

-- ---------------------------------------------------------------------------
-- FIM DO SCRIPT
-- ---------------------------------------------------------------------------

-- Verificação rápida: listar tabelas criadas
SELECT
  tablename AS tabela,
  pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS tamanho
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
