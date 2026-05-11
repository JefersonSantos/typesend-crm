const express = require('express');
const stripe  = require('stripe');
const { v4: uuidv4 } = require('uuid');
const { one, all, run, tx, getSetting } = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();

async function getStripe() {
  const key = await getSetting('stripe_secret_key', 'STRIPE_SECRET_KEY');
  if (!key) throw new Error('Stripe não configurado');
  return stripe(key);
}

/* ── Public rate card ────────────────────────────────────────────────────── */
router.get('/rates', authMiddleware, tenantOnly, async (req, res) => {
  try {
    const show = await getSetting('billing_show_rates_to_users');
    if (show === '0') return res.status(403).json({ error: 'Tabela de tarifas não disponível' });
    const rows = await all('SELECT resource_type, meta_base_cost, markup, description FROM pricing');
    const rates = rows.map(r => ({
      resource_type: r.resource_type,
      description:   r.description,
      per_unit:      +(parseFloat(r.meta_base_cost) + parseFloat(r.markup)).toFixed(6),
      markup:        +parseFloat(r.markup).toFixed(6),
    }));
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Credit balance ──────────────────────────────────────────────────────── */
router.get('/balance', authMiddleware, tenantOnly, async (req, res) => {
  try {
    const tenant = await one('SELECT credit_balance FROM tenants WHERE id = $1', [req.auth.tenantId]);
    res.json({ balance: parseFloat(tenant.credit_balance) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Transactions history ────────────────────────────────────────────────── */
router.get('/transactions', authMiddleware, tenantOnly, async (req, res) => {
  try {
    const { limit = 30, offset = 0 } = req.query;
    const [rows, total] = await Promise.all([
      all('SELECT * FROM credit_transactions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
          [req.auth.tenantId, Number(limit), Number(offset)]),
      one('SELECT COUNT(*) as n FROM credit_transactions WHERE tenant_id = $1', [req.auth.tenantId]),
    ]);
    res.json({ transactions: rows, total: parseInt(total.n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Orders list ─────────────────────────────────────────────────────────── */
router.get('/orders', authMiddleware, tenantOnly, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const [rows, total] = await Promise.all([
      all('SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
          [req.auth.tenantId, Number(limit), Number(offset)]),
      one('SELECT COUNT(*) as n FROM orders WHERE tenant_id = $1', [req.auth.tenantId]),
    ]);
    res.json({ orders: rows, total: parseInt(total.n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Create Stripe Checkout Session ─────────────────────────────────────── */
router.post('/checkout', authMiddleware, tenantOnly, async (req, res) => {
  try {
    const { amount } = req.body; // amount in USD cents
    const minUsdStr = await getSetting('billing_min_topup_usd');
    const minUsd    = parseFloat(minUsdStr || '5');
    const minCents  = Math.round(minUsd * 100);

    if (!amount || amount < minCents)
      return res.status(400).json({ error: `Valor mínimo de recarga: $${minUsd.toFixed(2)}` });

    let s;
    try { s = await getStripe(); } catch (e) { return res.status(503).json({ error: e.message }); }

    const amountUsd  = amount / 100;
    const frontendUrl = (await getSetting('frontend_url', 'FRONTEND_URL')) || 'http://localhost:5173';
    const session = await s.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'usd',
          product_data: { name: 'Créditos Typesend CRM', description: `$${amountUsd.toFixed(2)} em créditos WhatsApp` },
          unit_amount:  amount,
        },
        quantity: 1,
      }],
      mode:        'payment',
      success_url: `${frontendUrl}/billing?success=1&session={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}/billing?cancelled=1`,
      metadata:    { tenantId: req.auth.tenantId, credits: amountUsd.toFixed(2) },
    });

    const orderId = uuidv4();
    await run(
      'INSERT INTO orders (id, tenant_id, stripe_session_id, amount_usd, status) VALUES ($1, $2, $3, $4, $5)',
      [orderId, req.auth.tenantId, session.id, amountUsd, 'pending']
    );

    res.json({ url: session.url, sessionId: session.id, orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Stripe Webhook ──────────────────────────────────────────────────────── */
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = await getSetting('stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET');
  let event;

  if (secret) {
    try {
      const s = await getStripe();
      event = s.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // No signing secret configured — accept without validation (dev mode)
    try { event = JSON.parse(req.body.toString()); }
    catch { return res.status(400).send('Invalid JSON'); }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { tenantId, credits } = session.metadata || {};

      if (tenantId && credits && session.payment_status === 'paid') {
        const amount = parseFloat(credits);
        await tx(async (client) => {
          await client.query(
            "UPDATE orders SET status = 'paid', paid_at = NOW() WHERE stripe_session_id = $1",
            [session.id]
          );
          await client.query(
            'UPDATE tenants SET credit_balance = credit_balance + $1 WHERE id = $2',
            [amount, tenantId]
          );
          await client.query(
            'INSERT INTO credit_transactions (id, tenant_id, amount, type, description, stripe_session_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [uuidv4(), tenantId, amount, 'topup', `Recarga via Stripe: $${amount}`, session.id]
          );
        });
      }
    }

    if (event.type === 'checkout.session.expired') {
      await run(
        "UPDATE orders SET status = 'expired' WHERE stripe_session_id = $1 AND status = 'pending'",
        [event.data.object.id]
      );
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      await run(
        "UPDATE orders SET status = 'failed' WHERE stripe_session_id = $1 AND status = 'pending'",
        [event.data.object.id]
      );
    }
  } catch (err) {
    console.error('[billing/webhook] Erro ao processar evento Stripe:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;
