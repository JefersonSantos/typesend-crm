const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { one, all, run } = require('../db/database');
const { authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

router.get('/', async (req, res) => {
  try {
    const { level, category, limit = 100, offset = 0 } = req.query;
    let q = 'SELECT * FROM logs WHERE tenant_id = $1';
    const params = [req.auth.tenantId];
    let idx = 2;
    if (level)    { q += ` AND level = $${idx++}`;    params.push(level); }
    if (category) { q += ` AND category = $${idx++}`; params.push(category); }
    q += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const [logs, total] = await Promise.all([
      all(q, params),
      one('SELECT COUNT(*) as n FROM logs WHERE tenant_id = $1', [req.auth.tenantId]),
    ]);
    res.json({ logs, total: parseInt(total.n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Fire-and-forget log writer called from other routes */
async function writeLog(tenantId, userId, level, category, message, metadata) {
  try {
    await run(
      'INSERT INTO logs (id, tenant_id, user_id, level, category, message, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [uuidv4(), tenantId || null, userId || null, level, category, message, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (_) { /* non-fatal */ }
}

module.exports = router;
module.exports.writeLog = writeLog;
