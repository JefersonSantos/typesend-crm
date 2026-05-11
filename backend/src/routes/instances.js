const { Router } = require('express');
const { one, all } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// GET /api/instances — instâncias ativas atribuídas ao tenant logado
router.get('/', async (req, res) => {
  try {
    const instances = await all(
      `SELECT id, name, display_phone, display_name, status, created_at
       FROM whatsapp_instances
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY name`,
      [req.auth.tenantId]
    );
    res.json(instances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/instances/:id — detalhes de uma instância (sem access_token)
router.get('/:id', async (req, res) => {
  try {
    const instance = await one(
      `SELECT id, name, display_phone, display_name, status, created_at
       FROM whatsapp_instances
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth.tenantId]
    );
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });
    res.json(instance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
