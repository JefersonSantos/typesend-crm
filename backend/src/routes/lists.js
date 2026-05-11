const express  = require('express');
const multer   = require('multer');
const { parse }  = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
const { one, all, run, tx } = require('../db/database');
const { normalizePhone } = require('../services/phoneNormalizer');
const { estimateLookup, runListLookup } = require('../services/lookup');
const { authMiddleware, tenantOnly } = require('../middleware/auth');
const { writeLog } = require('./logs');

const router = express.Router();
router.use(authMiddleware, tenantOnly);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function parseCSV(buffer) {
  const text      = buffer.toString('utf-8').replace(/^﻿/, '');
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

router.post('/import', upload.single('file'), async (req, res) => {
  const { name, phone_column, country_code = '+55' } = req.body;
  if (!name || !phone_column) return res.status(400).json({ error: 'name e phone_column obrigatórios' });

  try {
    const records = parseCSV(req.file.buffer);
    if (!records.length) return res.status(400).json({ error: 'CSV vazio' });
    const columns = Object.keys(records[0]);
    if (!columns.includes(phone_column)) return res.status(400).json({ error: `Coluna "${phone_column}" não encontrada` });

    const listId   = uuidv4();
    let imported   = 0;
    let skipped    = 0;

    await tx(async (client) => {
      await client.query(
        'INSERT INTO lists (id, tenant_id, name, columns, phone_column, country_code) VALUES ($1, $2, $3, $4, $5, $6)',
        [listId, req.auth.tenantId, name, JSON.stringify(columns), phone_column, country_code]
      );
      for (const record of records) {
        const raw = record[phone_column];
        if (!raw) { skipped++; continue; }
        const phone = normalizePhone(String(raw), country_code);
        if (!phone) { skipped++; continue; }
        await client.query(
          'INSERT INTO list_contacts (id, list_id, phone, data) VALUES ($1, $2, $3, $4)',
          [uuidv4(), listId, phone, JSON.stringify(record)]
        );
        imported++;
      }
      await client.query('UPDATE lists SET contact_count = $1 WHERE id = $2', [imported, listId]);
    });

    writeLog(req.auth.tenantId, req.auth.sub, 'info', 'list', `Lista importada: ${name} (${imported} contatos)`, { listId });
    res.status(201).json({ id: listId, name, columns, phone_column, contact_count: imported, skipped });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const lists = await all('SELECT * FROM lists WHERE tenant_id = $1 ORDER BY created_at DESC', [req.auth.tenantId]);
    res.json(lists.map(l => ({ ...l, columns: JSON.parse(l.columns) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const list = await one('SELECT * FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
    res.json({ ...list, columns: JSON.parse(list.columns) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/contacts', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const list = await one('SELECT * FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

    const contacts = await all(`
      SELECT lc.*,
             lr.valid         as lookup_valid,
             lr.line_type     as lookup_line_type,
             lr.carrier       as lookup_carrier,
             lr.looked_up_at,
             CASE WHEN o.phone IS NOT NULL THEN true ELSE false END as opted_out
      FROM list_contacts lc
      LEFT JOIN lookup_results lr ON lr.contact_id = lc.id
      LEFT JOIN optouts        o  ON o.phone = lc.phone
      WHERE lc.list_id = $1
      LIMIT $2 OFFSET $3
    `, [req.params.id, Number(limit), Number(offset)]);

    res.json({
      list:     { ...list, columns: JSON.parse(list.columns) },
      contacts: contacts.map(c => ({ ...c, data: JSON.parse(c.data) })),
      total:    list.contact_count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const list = await one('SELECT id FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
    await run('DELETE FROM list_contacts WHERE list_id = $1', [req.params.id]);
    await run('DELETE FROM lists WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Segments ────────────────────────────────────────────────────────────── */
router.get('/:id/segments', async (req, res) => {
  try {
    const list = await one('SELECT id FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
    const segs = await all('SELECT * FROM segments WHERE list_id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    res.json(segs.map(s => ({ ...s, filters: JSON.parse(s.filters) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/segments', async (req, res) => {
  try {
    const { name, filters } = req.body;
    if (!name || !filters) return res.status(400).json({ error: 'name e filters obrigatórios' });

    const list = await one('SELECT id FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

    // Count contacts matching filters
    const contacts = await all('SELECT data FROM list_contacts WHERE list_id = $1', [req.params.id]);
    const count = contacts.filter(c => {
      const data = JSON.parse(c.data);
      return filters.every(f => {
        const val = String(data[f.column] || '').toLowerCase();
        if (f.op === 'contains')    return val.includes(f.value.toLowerCase());
        if (f.op === 'equals')      return val === f.value.toLowerCase();
        if (f.op === 'starts_with') return val.startsWith(f.value.toLowerCase());
        if (f.op === 'not_empty')   return val.length > 0;
        return true;
      });
    }).length;

    const id = uuidv4();
    await run(
      'INSERT INTO segments (id, tenant_id, list_id, name, filters, contact_count) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.auth.tenantId, req.params.id, name, JSON.stringify(filters), count]
    );
    res.status(201).json(await one('SELECT * FROM segments WHERE id = $1', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:listId/segments/:segId', async (req, res) => {
  try {
    await run('DELETE FROM segments WHERE id = $1 AND tenant_id = $2', [req.params.segId, req.auth.tenantId]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Phone Lookup ────────────────────────────────────────────────────────── */

// Estimate cost before running
router.get('/:id/lookup/estimate', async (req, res) => {
  try {
    const list = await one('SELECT id, contact_count FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
    const estimate = estimateLookup(list.contact_count);
    const tenant   = await one('SELECT credit_balance FROM tenants WHERE id = $1', [req.auth.tenantId]);
    const balance  = parseFloat(tenant.credit_balance);
    res.json({ ...estimate, balance, sufficient: balance >= estimate.totalCost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run lookup (async — streams SSE progress)
router.post('/:id/lookup', async (req, res) => {
  try {
    const list = await one('SELECT id, name, contact_count FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get lookup results for a list
router.get('/:id/lookup/results', async (req, res) => {
  try {
    const list = await one('SELECT id FROM lists WHERE id = $1 AND tenant_id = $2', [req.params.id, req.auth.tenantId]);
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });

    const { limit = 100, offset = 0, line_type } = req.query;
    let q = 'SELECT * FROM lookup_results WHERE list_id = $1';
    const params = [req.params.id];
    let idx = 2;
    if (line_type) { q += ` AND line_type = $${idx++}`; params.push(line_type); }
    q += ` ORDER BY looked_up_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const [results, total, summary] = await Promise.all([
      all(q, params),
      one('SELECT COUNT(*) as n FROM lookup_results WHERE list_id = $1', [req.params.id]),
      all('SELECT line_type, COUNT(*) as count FROM lookup_results WHERE list_id = $1 GROUP BY line_type', [req.params.id]),
    ]);
    res.json({ results, total: parseInt(total.n), summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
