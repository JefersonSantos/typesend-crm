# SMS CRM — MVP com Twilio

CRM simples para envio de SMS e acompanhamento de mensagens via Twilio.

## Pré-requisitos

- Node.js 18+
- Conta Twilio com Account SID, Auth Token e número de telefone
- ngrok (opcional, para receber webhooks em desenvolvimento)

---

## Instalação

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edite o `.env` com suas credenciais Twilio:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=seu_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
WEBHOOK_URL=https://seu-ngrok.ngrok.io   # opcional
```

```bash
npm run dev
# Rodando em http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# Rodando em http://localhost:5173
```

---

## Configurar Webhooks (opcional mas recomendado)

Para receber atualizações de status de entrega em tempo real:

1. Instale o ngrok: https://ngrok.com/download
2. Rode: `ngrok http 3001`
3. Copie a URL gerada (ex: `https://abcd1234.ngrok.io`)
4. Adicione ao `.env`: `WEBHOOK_URL=https://abcd1234.ngrok.io`
5. Reinicie o backend

---

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Contatos** | Cadastrar, editar, excluir e buscar contatos |
| **Enviar SMS** | Selecionar contato e enviar mensagem via Twilio |
| **Histórico** | Ver todas as mensagens com status, custo e filtros |

---

## Estrutura do projeto

```
sms-crm/
├── backend/
│   ├── src/
│   │   ├── app.js              # Entry point Express
│   │   ├── db/database.js      # SQLite + schema
│   │   ├── services/twilio.js  # Integração Twilio
│   │   └── routes/
│   │       ├── contacts.js     # CRUD contatos
│   │       ├── messages.js     # Envio + histórico
│   │       └── webhooks.js     # Status callbacks Twilio
│   └── data/crm.db             # Banco SQLite (gerado automaticamente)
└── frontend/
    └── src/
        ├── App.jsx
        ├── services/api.js     # Chamadas ao backend
        └── pages/
            ├── ContactsPage.jsx
            ├── SendPage.jsx
            └── HistoryPage.jsx
```

---

## Próximos passos (Fase 2)

- [ ] Campanhas em massa com fila (BullMQ + Redis)
- [ ] Importação de contatos via CSV
- [ ] Opt-out automático via STOP
- [ ] Dashboard com gráficos de performance
