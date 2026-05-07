# Maiver ISV — Referência do Projeto

## Stack
- **Backend:** Node.js 22 + Express + SQLite (node:sqlite nativo)
- **Frontend:** React + Vite
- **Infra:** Docker Swarm + Traefik (SSL automático Let's Encrypt)
- **Pagamentos:** Stripe (checkout + webhooks)
- **SMS:** Twilio (por tenant ou global)
- **IA:** Anthropic Claude (por tenant ou global)

## Repositório
- **GitHub:** `JefersonSantos/maiver-isv`
- **Local:** `C:\Users\jfers\OneDrive\Documentos\Batista Tech\Marketing\sms-crm`

## URLs de Produção
- **Frontend:** https://maiver-isv.vercel.app
- **Backend API:** https://api-test.appmaiver.com/api
- **Health check:** https://api-test.appmaiver.com/health

## Infraestrutura VPS
- **IP:** 46.224.100.147
- **Stack Docker:** `/root/maiver.yml`
- **Imagem:** `maiver-backend:latest`
- **Serviço PM2:** descontinuado (usa Docker Swarm)
- **Rede Docker:** `Maiver` (externa, compartilhada com Traefik, n8n, Evolution, pgAdmin)
- **Volume dados:** `maiver_data` → `/app/data/maiver.db`

### Outros serviços na VPS
| Serviço | URL |
|---|---|
| Traefik | gerencia todo o tráfego |
| PostgreSQL 14 | porta 5432 (Docker) |
| pgAdmin | via Traefik |
| n8n | n8n-test.appmaiver.com |
| Evolution API | via Traefik |
| Portainer | via Traefik |

## Credenciais Padrão (admin)
- **Email:** admin@maiver.com
- **Senha:** Maiver@2025

## Arquitetura Multitenant
- Cada cliente = 1 **tenant** com `credit_balance`
- Usuários pertencem a um tenant
- Recursos (SMS, Lookup, etc.) debitam créditos automaticamente
- Admin pode ajustar saldo e configurar preços

## Tabela de Precificação (admin configurável)
| Recurso | Custo Twilio | Markup | Total |
|---|---|---|---|
| SMS Enviado | $0.0079 | $0.005 | $0.0129 |
| SMS Recebido | $0.0075 | $0.002 | $0.0095 |
| Phone Lookup | $0.005 | $0.002 | $0.007 |
| API Call | $0 | $0.0001 | $0.0001 |

## Funcionalidades Implementadas
- [x] Autenticação admin + usuário (JWT)
- [x] Gestão de tenants (criar, editar, suspender)
- [x] Configuração Twilio por tenant (subconta própria)
- [x] Configuração Anthropic Claude por tenant
- [x] Listas de contatos (import CSV)
- [x] Segmentos com filtros
- [x] Templates de SMS com variáveis
- [x] Campanhas (draft → scheduled → sending → completed)
- [x] Chat (conversas inbound/outbound)
- [x] Phone Lookup (Twilio Lookup V2, SSE streaming)
- [x] Recarga de créditos via Stripe Checkout
- [x] Webhook Stripe (confirma pagamento → adiciona crédito)
- [x] Histórico de orders (pending/paid/failed/expired)
- [x] Tabela de tarifas para usuário (toggle admin)
- [x] IA: sugestão e melhoria de mensagens (Claude)
- [x] Logs do sistema
- [x] Painel admin: dashboard, tenants, pricing, settings, billing, logs

## Webhooks Twilio
- **Status callback:** `https://api-test.appmaiver.com/api/webhooks/twilio`
- **Inbound SMS (chat):** `https://api-test.appmaiver.com/api/webhooks/inbound`

## Webhook Stripe
- **URL:** `https://api-test.appmaiver.com/api/billing/stripe-webhook`
- **Eventos:** `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`

## Pendente / Próximos Passos
- [ ] Assinatura mensal recorrente por tenant (Stripe Subscriptions)
- [ ] Planos com features/limites diferentes
- [ ] Identificação correta de tenant no webhook inbound (por número Twilio)
- [ ] Migração de SQLite para PostgreSQL (já rodando na VPS)
- [ ] Testes automatizados

## Comandos Úteis (VPS)

```bash
# Ver status dos serviços
docker service ls

# Logs do backend
docker service logs maiver_backend --tail 50

# Rebuild e redeploy após push no GitHub
cd /root/maiver-isv && git pull
cd backend && docker build -t maiver-backend:latest .
export $(grep -v '^#' .env | grep -v '^$' | xargs)
docker stack deploy -c /root/maiver.yml maiver

# Atualizar variável de ambiente
docker service update --env-add CHAVE=VALOR maiver_backend
```

## Estrutura de Arquivos
```
sms-crm/
├── backend/
│   ├── src/
│   │   ├── app.js              # Entry point
│   │   ├── db/database.js      # Schema SQLite + getSetting()
│   │   ├── db/seed.js          # Admin padrão
│   │   ├── middleware/auth.js  # JWT middleware
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── admin.js
│   │   │   ├── billing.js
│   │   │   ├── lists.js
│   │   │   ├── templates.js
│   │   │   ├── campaigns.js
│   │   │   ├── chat.js
│   │   │   ├── logs.js
│   │   │   ├── ai.js
│   │   │   └── webhooks.js
│   │   └── services/
│   │       ├── twilio.js       # SMS + Lookup (por tenant)
│   │       ├── costCalculator.js
│   │       └── lookup.js
│   ├── Dockerfile
│   └── .env                    # NÃO commitar
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── services/api.js
│   │   ├── layouts/
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   └── user/
│   │   └── components/
│   └── vercel.json
├── database/
│   ├── maiver_postgres.sql     # Schema PostgreSQL completo
│   └── reset_and_create.sql    # DROP + recreate (fresh install)
└── PROJETO.md                  # Este arquivo
```
