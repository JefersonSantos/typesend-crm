const express = require('express');
const stripe  = require('stripe');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { getSetting } = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();

function getStripe() {
  const key = getSetting('stripe_secret_key', 'STRIPE_SECRET_KEY');
  if (!key) throw new Error('Stripe não configurado');
  return stripe(key);
}

/* ── Public rate card (respects billing_show_rates_to_users setting) ─────── */
router.get('/rates', authMiddleware, tenantOnly, (req, res) => {
  const show = getSetting('billing_show_rates_to_users');
  if (show === '0') return res.status(403).json({ error: 'Tabela de tarifas não disponível' });
  const rows = db.prepare('SELECT resource_type, twilio_base_cost, markup, description FROM pricing').all();
  const rates = rows.map(r => ({
    resource_type: r.resource_type,
    description:   r.description,
    per_unit:      +(r.twilio_base_cost + r.markup).toFixed(6),
    markup:        +(r.markup).toFixed(6),
  }));
  res.json(rates);
});

/* ── Credit balance ──────────────────────────────────────────────────────── */
router.get('/balance', authMiddleware, tenantOnly, (req, res) => {
  const tenant = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(req.auth.tenantId);
  res.json({ balance: tenant.credit_balance });
});

/* ── Transactions history ────────────────────────────────────────────────── */
router.get('/transactions', authMiddleware, tenantOnly, (req, res) => {
  const { limit = 30, offset = 0 } = req.query;
  const rows = db.prepare(
    'SELECT * FROM credit_transactions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(req.auth.tenantId, Number(limit), Number(offset));
  const total = db.prepare('SELECT COUNT(*) as n FROM credit_transactions WHERE tenant_id = ?').get(req.auth.tenantId);
  res.json({ transactions: rows, total: total.n });
});

/* ── Orders list ─────────────────────────────────────────────────────────── */
router.get('/orders', authMiddleware, tenantOnly, (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const rows = db.prepare(
    'SELECT * FROM orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(req.auth.tenantId, Number(limit), Number(offset));
  const total = db.prepare('SELECT COUNT(*) as n FROM orders WHERE tenant_id = ?').get(req.auth.tenantId);
  res.json({ orders: rows, total: total.n });
});

/* ── Create Stripe Checkout Session ─────────────────────────────────────── */
router.post('/checkout', authMiddleware, tenantOnly, async (req, res) => {
  const { amount } = req.body; // amount in USD cents
  const minUsd   = parseFloat(getSetting('billing_min_topup_usd') || '5');
  const minCents = Math.round(minUsd * 100);

  if (!amount || amount < minCents)
    return res.status(400).json({ error: `Valor mínimo de recarga: $${minUsd.toFixed(2)}` });

  let s;
  try { s = getStripe(); } catch (e) { return res.status(503).json({ error: e.message }); }

  try {
    const amountUsd = amount / 100;
    const session = await s.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Créditos Maiver SMS', description: `$${amountUsd.toFixed(2)} em créditos` },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${getSetting('frontend_url', 'FRONTEND_URL') || 'http://localhost:5173'}/billing?success=1&session={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${getSetting('frontend_url', 'FRONTEND_URL') || 'http://localhost:5173'}/billing?cancelled=1`,
      metadata: { tenantId: req.auth.tenantId, credits: amountUsd.toFixed(2) },
    });

    // Create pending order record
    const orderId = uuidv4();
    db.prepare(
      'INSERT INTO orders (id, tenant_id, stripe_session_id, amount_usd, status) VALUES (?, ?, ?, ?, ?)'
    ).run(orderId, req.auth.tenantId, session.id, amountUsd, 'pending');

    res.json({ url: session.url, sessionId: session.id, orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Stripe Webhook ──────────────────────────────────────────────────────── */
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig     = req.headers['stripe-signature'];
  const secret  = getSetting('stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET');
  let event;

  if (secret) {
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // No signing secret configured — accept without validation (dev mode)
    try { event = JSON.parse(req.body.toString()); }
    catch { return res.status(400).send('Invalid JSON'); }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { tenantId, credits } = session.metadata || {};

    if (tenantId && credits && session.payment_status === 'paid') {
      const amount = parseFloat(credits);
      db.exec('BEGIN');
      // Update order status → paid
      db.prepare(
        "UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE stripe_session_id = ?"
      ).run(session.id);
      // Add credits
      db.prepare('UPDATE tenants SET credit_balance = credit_balance + ? WHERE id = ?').run(amount, tenantId);
      db.prepare(
        'INSERT INTO credit_transactions (id, tenant_id, amount, type, description, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), tenantId, amount, 'topup', `Recarga via Stripe: $${amount}`, session.id);
      db.exec('COMMIT');
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    db.prepare(
      "UPDATE orders SET status = 'expired' WHERE stripe_session_id = ? AND status = 'pending'"
    ).run(session.id);
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    db.prepare(
      "UPDATE orders SET status = 'failed' WHERE stripe_session_id = ? AND status = 'pending'"
    ).run(session.id);
  }

  res.json({ received: true });
});

module.exports = router;
