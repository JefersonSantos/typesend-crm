const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { one, run } = require('./database');

async function seed() {
  // ── Admin user ───────────────────────────────────────────────────────────
  const existing = await one('SELECT id FROM admin_users LIMIT 1');
  if (!existing) {
    const email    = process.env.ADMIN_EMAIL    || 'admin@typesendcrm.com';
    const password = process.env.ADMIN_PASSWORD || 'Typesend@2025';
    const hash     = await bcrypt.hash(password, 12);

    await run(
      'INSERT INTO admin_users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)',
      [uuidv4(), email, hash, 'Super Admin']
    );
    console.log(`✓ Admin criado: ${email}`);
  }

  // ── Settings from env vars (only if DB value is still empty) ────────────
  const envSettings = [
    { key: 'meta_webhook_verify_token', envVar: 'META_WEBHOOK_VERIFY_TOKEN' },
    { key: 'meta_app_id',               envVar: 'META_APP_ID' },
    { key: 'meta_app_secret',           envVar: 'META_APP_SECRET' },
    { key: 'meta_global_access_token',  envVar: 'META_GLOBAL_ACCESS_TOKEN' },
  ];

  for (const { key, envVar } of envSettings) {
    const val = process.env[envVar];
    if (!val) continue;
    const row = await one('SELECT value FROM system_settings WHERE key = $1', [key]);
    if (row && (!row.value || row.value.trim() === '')) {
      await run(
        'UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = $2',
        [val, key]
      );
      console.log(`✓ Setting '${key}' aplicado do env var`);
    }
  }
}

module.exports = seed;
