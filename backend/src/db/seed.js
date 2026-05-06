const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

async function seed() {
  const existing = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
  if (existing) return;

  const email = process.env.ADMIN_EMAIL || 'admin@maiver.com';
  const password = process.env.ADMIN_PASSWORD || 'Maiver@2025';
  const hash = await bcrypt.hash(password, 12);

  db.prepare('INSERT INTO admin_users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
    uuidv4(), email, hash, 'Super Admin'
  );
  console.log(`✓ Admin criado: ${email} / ${password}`);
}

module.exports = seed;
