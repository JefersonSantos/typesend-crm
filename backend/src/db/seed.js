const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { one, run } = require('./database');

async function seed() {
  const existing = await one('SELECT id FROM admin_users LIMIT 1');
  if (existing) return;

  const email    = process.env.ADMIN_EMAIL    || 'admin@typesendcrm.com';
  const password = process.env.ADMIN_PASSWORD || 'Typesend@2025';
  const hash     = await bcrypt.hash(password, 12);

  await run(
    'INSERT INTO admin_users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)',
    [uuidv4(), email, hash, 'Super Admin']
  );
  console.log(`✓ Admin criado: ${email}`);
}

module.exports = seed;
