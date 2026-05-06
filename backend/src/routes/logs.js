const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

router.get('/', (req, res) => {
  const { level, category, limit = 100, offset = 0 } = req.query;
  let q = 'SELECT * FROM logs WHERE tenant_id = ?';
  const params = [req.auth.tenantId];
  if (level)    { q += ' AND level = ?';    params.push(level); }
  if (category) { q += ' AND category = ?'; params.push(category); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const total = db.prepare('SELECT COUNT(*) as n FROM logs WHERE tenant_id = ?').get(req.auth.tenantId);
  res.json({ logs: db.prepare(q).all(...params), total: total.n });
});

/* helper for other routes to call */
function writeLog(tenantId, userId, level, category, message, metadata) {
  db.prepare('INSERT INTO logs (id, tenant_id, user_id, level, category, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    uuidv4(), tenantId || null, userId || null, level, category, message, metadata ? JSON.stringify(metadata) : null
  );
}

module.exports = router;
module.exports.writeLog = writeLog;
