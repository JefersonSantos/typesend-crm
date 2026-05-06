require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const seed = require('./db/seed');
const { authMiddleware } = require('./middleware/auth');

const authRouter     = require('./routes/auth');
const adminRouter    = require('./routes/admin');
const billingRouter  = require('./routes/billing');
const listsRouter    = require('./routes/lists');
const templatesRouter = require('./routes/templates');
const campaignsRouter = require('./routes/campaigns');
const chatRouter     = require('./routes/chat');
const logsRouter     = require('./routes/logs');
const aiRouter       = require('./routes/ai');
const webhooksRouter = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3001;

// Raw body for Stripe webhook
app.use('/api/billing/stripe-webhook', express.raw({ type: 'application/json' }));

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5174' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_, res) => res.json({ ok: true, service: 'Maiver SMS Platform v2' }));

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

// ── Cron: check scheduled campaigns every minute ──────────────────────────
const { runCampaign } = require('./routes/campaigns');
cron.schedule('* * * * *', () => {
  const db = require('./db/database');
  const due = db.prepare(
    "SELECT id, tenant_id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= datetime('now')"
  ).all();
  for (const c of due) {
    db.prepare("UPDATE campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?").run(c.id);
    runCampaign(c.id, c.tenant_id);
  }
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

seed().then(() => {
  app.listen(PORT, () => console.log(`🚀 Maiver rodando em http://localhost:${PORT}`));
});
