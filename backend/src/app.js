require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');

const seed              = require('./db/seed');
const { initDb, all, run } = require('./db/database');
const { authMiddleware } = require('./middleware/auth');

const authRouter      = require('./routes/auth');
const adminRouter     = require('./routes/admin');
const billingRouter   = require('./routes/billing');
const listsRouter     = require('./routes/lists');
const templatesRouter = require('./routes/templates');
const campaignsRouter = require('./routes/campaigns');
const chatRouter      = require('./routes/chat');
const logsRouter      = require('./routes/logs');
const aiRouter        = require('./routes/ai');
const webhooksRouter  = require('./routes/webhooks');
const instancesRouter = require('./routes/instances');

const app  = express();
const PORT = process.env.PORT || 3001;

// Raw body para Stripe webhook
app.use('/api/billing/stripe-webhook', express.raw({ type: 'application/json' }));

// Raw body para Meta webhook
app.use('/api/webhooks/meta', express.json());

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_, res) => res.json({ ok: true, service: 'Typesend CRM WhatsApp Platform v1' }));

app.use('/api/auth',      authRouter);
app.use('/api/admin',     adminRouter);
app.use('/api/billing',   billingRouter);
app.use('/api/lists',     listsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/chat',      chatRouter);
app.use('/api/logs',      logsRouter);
app.use('/api/ai',        aiRouter);
app.use('/api/webhooks',  webhooksRouter);
app.use('/api/instances', instancesRouter);

// ── Cron: disparar campanhas agendadas a cada minuto ──────────────────────
const { runCampaign } = require('./routes/campaigns');
cron.schedule('* * * * *', async () => {
  try {
    const due = await all(
      "SELECT id, tenant_id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= NOW()"
    );
    for (const c of due) {
      await run(
        "UPDATE campaigns SET status = 'sending', started_at = NOW() WHERE id = $1",
        [c.id]
      );
      runCampaign(c.id, c.tenant_id);
    }
  } catch (err) {
    console.error('[cron] Erro ao processar campanhas agendadas:', err.message);
  }
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

initDb()
  .then(seed)
  .then(() => {
    app.listen(PORT, () => console.log(`Typesend CRM rodando em http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Falha na inicialização:', err);
    process.exit(1);
  });
