const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { extractVariables } = require('../services/templateRenderer');
const { authMiddleware, tenantOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, tenantOnly);

router.get('/', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates WHERE tenant_id = ? ORDER BY created_at DESC').all(req.auth.tenantId);
  res.json(templates.map(t => ({ ...t, variables: JSON.parse(t.variables) })));
});

router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!t) return res.status(404).json({ error: 'Modelo não encontrado' });
  res.json({ ...t, variables: JSON.parse(t.variables) });
});

router.post('/', (req, res) => {
  const { name, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name e body obrigatórios' });
  const id = uuidv4();
  const variables = extractVariables(body);
  db.prepare('INSERT INTO templates (id, tenant_id, name, body, variables) VALUES (?, ?, ?, ?, ?)').run(id, req.auth.tenantId, name, body, JSON.stringify(variables));
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  res.status(201).json({ ...t, variables: JSON.parse(t.variables) });
});

router.put('/:id', (req, res) => {
  const { name, body } = req.body;
  const t = db.prepare('SELECT id FROM templates WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!t) return res.status(404).json({ error: 'Modelo não encontrado' });
  const variables = extractVariables(body || '');
  db.prepare('UPDATE templates SET name = ?, body = ?, variables = ? WHERE id = ?').run(name, body, JSON.stringify(variables), req.params.id);
  const updated = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  res.json({ ...updated, variables: JSON.parse(updated.variables) });
});

router.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT id FROM templates WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!t) return res.status(404).json({ error: 'Modelo não encontrado' });
  const inUse = db.prepare('SELECT id FROM campaigns WHERE template_id = ? AND tenant_id = ? LIMIT 1').get(req.params.id, req.auth.tenantId);
  if (inUse) return res.status(409).json({ error: 'Modelo em uso por uma campanha' });
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
