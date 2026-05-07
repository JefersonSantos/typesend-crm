const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { normalizePhone } = require('../services/phoneNormalizer');
const { estimateLookup, runListLookup } = require('../services/lookup');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { writeLog } = require('./logs');

const router = express.Router();
router.use(authMiddleware, tenantOnly);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function parseCSV(buffer) {
  const text = buffer.toString('utf-8').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  return parse(text, { columns: true, skip_empty_lines: true, trim: true, delimiter, relax_quotes: true, skip_records_with_error: true });
}

router.post('/preview', upload.single('file'), (req, res) => {
  try {
    const records = parseCSV(req.file.buffer);
    if (!records.length) return res.status(400).json({ error: 'CSV vazio' });
    const columns = Object.keys(records[0]);
    res.json({ columns, preview: records.slice(0, 5), total: records.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/import', upload.single('file'), (req, res) => {
  const { name, phone_column, country_code = '+55' } = req.body;
  if (!name || !phone_column) return res.status(400).json({ error: 'name e phone_column obrigatórios' });

  try {
    const records = parseCSV(req.file.buffer);
    if (!records.length) return res.status(400).json({ error: 'CSV vazio' });
    const columns = Object.keys(records[0]);
    if (!columns.includes(phone_column)) return res.status(400).json({ error: `Coluna "${phone_column}" não encontrada` });

    const listId = uuidv4();
    let imported = 0, skipped = 0;
    db.exec('BEGIN');
    db.prepare('INSERT INTO lists (id, tenant_id, name, columns, phone_column, country_code) VALUES (?, ?, ?, ?, ?, ?)').run(listId, req.auth.tenantId, name, JSON.stringify(columns), phone_column, country_code);
    const ins = db.prepare('INSERT INTO list_contacts (id, list_id, phone, data) VALUES (?, ?, ?, ?)');
    for (const record of records) {
      const raw = record[phone_column]; if (!raw) { skipped++; continue; }
      const phone = normalizePhone(String(raw), country_code); if (!phone) { skipped++; continue; }
      ins.run(uuidv4(), listId, phone, JSON.stringify(record)); imported++;
    }
    db.prepare('UPDATE lists SET contact_count = ? WHERE id = ?').run(imported, listId);
    db.exec('COMMIT');
    writeLog(req.auth.tenantId, req.auth.sub, 'info', 'list', `Lista importada: ${name} (${imported} contatos)`, { listId });
    res.status(201).json({ id: listId, name, columns, phone_column, contact_count: imported, skipped });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  const lists = db.prepare('SELECT * FROM lists WHERE tenant_id = ? ORDER BY created_at DESC').all(req.auth.tenantId);
  res.json(lists.map(l => ({ ...l, columns: JSON.parse(l.columns) })));
});

router.get('/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
  res.json({ ...list, columns: JSON.parse(list.columns) });
});

router.get('/:id/contacts', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

  // Join with lookup_results and optouts for enriched contact data
  const contacts = db.prepare(`
    SELECT lc.*,
           lr.valid       as lookup_valid,
           lr.line_type   as lookup_line_type,
           lr.carrier     as lookup_carrier,
           lr.looked_up_at,
           CASE WHEN o.phone IS NOT NULL THEN 1 ELSE 0 END as opted_out
    FROM list_contacts lc
    LEFT JOIN lookup_results lr ON lr.contact_id = lc.id
    LEFT JOIN optouts o ON o.phone = lc.phone
    WHERE lc.list_id = ?
    LIMIT ? OFFSET ?
  `).all(req.params.id, Number(limit), Number(offset));

  res.json({
    list: { ...list, columns: JSON.parse(list.columns) },
    contacts: contacts.map(c => ({ ...c, data: JSON.parse(c.data) })),
    total: list.contact_count,
  });
});

router.delete('/:id', (req, res) => {
  const list = db.prepare('SELECT id FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
  db.prepare('DELETE FROM list_contacts WHERE list_id = ?').run(req.params.id);
  db.prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

/* ── Segments ────────────────────────────────────────────────────────────── */
router.get('/:id/segments', (req, res) => {
  const list = db.prepare('SELECT id FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
  res.json(db.prepare('SELECT * FROM segments WHERE list_id = ? AND tenant_id = ?').all(req.params.id, req.auth.tenantId).map(s => ({ ...s, filters: JSON.parse(s.filters) })));
});

router.post('/:id/segments', (req, res) => {
  const { name, filters } = req.body;
  if (!name || !filters) return res.status(400).json({ error: 'name e filters obrigatórios' });
  const list = db.prepare('SELECT id FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

  // Count contacts matching filters
  const contacts = db.prepare('SELECT data FROM list_contacts WHERE list_id = ?').all(req.params.id);
  const count = contacts.filter(c => {
    const data = JSON.parse(c.data);
    return filters.every(f => {
      const val = String(data[f.column] || '').toLowerCase();
      if (f.op === 'contains')     return val.includes(f.value.toLowerCase());
      if (f.op === 'equals')       return val === f.value.toLowerCase();
      if (f.op === 'starts_with')  return val.startsWith(f.value.toLowerCase());
      if (f.op === 'not_empty')    return val.length > 0;
      return true;
    });
  }).length;

  const id = uuidv4();
  db.prepare('INSERT INTO segments (id, tenant_id, list_id, name, filters, contact_count) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.auth.tenantId, req.params.id, name, JSON.stringify(filters), count);
  res.status(201).json(db.prepare('SELECT * FROM segments WHERE id = ?').get(id));
});

router.delete('/:listId/segments/:segId', (req, res) => {
  db.prepare('DELETE FROM segments WHERE id = ? AND tenant_id = ?').run(req.params.segId, req.auth.tenantId);
  res.status(204).send();
});

/* ── Phone Lookup ────────────────────────────────────────────────────────── */

// Estimate cost before running
router.get('/:id/lookup/estimate', (req, res) => {
  const list = db.prepare('SELECT id, contact_count FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
  const estimate = estimateLookup(list.contact_count);
  const tenant = db.prepare('SELECT credit_balance FROM tenants WHERE id = ?').get(req.auth.tenantId);
  res.json({ ...estimate, balance: tenant.credit_balance, sufficient: tenant.credit_balance >= estimate.totalCost });
});

// Run lookup (async — streams SSE progress)
router.post('/:id/lookup', async (req, res) => {
  const list = db.prepare('SELECT id, name, contact_count FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

  // Use SSE for real-time progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const summary = await runListLookup(list.id, req.auth.tenantId, ({ done, total, phone, result }) => {
      send({ type: 'progress', done, total, phone, valid: result.valid, line_type: result.line_type });
    });
    writeLog(req.auth.tenantId, req.auth.sub, 'info', 'lookup', `Lookup concluído: ${list.name}`, summary);
    send({ type: 'done', ...summary });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
});

// Get lookup results for a list
router.get('/:id/lookup/results', (req, res) => {
  const list = db.prepare('SELECT id FROM lists WHERE id = ? AND tenant_id = ?').get(req.params.id, req.auth.tenantId);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
  const { limit = 100, offset = 0, line_type } = req.query;
  let q = 'SELECT * FROM lookup_results WHERE list_id = ?';
  const params = [req.params.id];
  if (line_type) { q += ' AND line_type = ?'; params.push(line_type); }
  q += ' ORDER BY looked_up_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const total = db.prepare('SELECT COUNT(*) as n FROM lookup_results WHERE list_id = ?').get(req.params.id).n;
  const summary = db.prepare(`
    SELECT line_type, COUNT(*) as count FROM lookup_results WHERE list_id = ? GROUP BY line_type
  `).all(req.params.id);
  res.json({ results: db.prepare(q).all(...params), total, summary });
});

module.exports = router;
