import { useState, useEffect, useRef } from 'react';
import { lists as api } from '../services/api';
import UserLayout from '../layouts/UserLayout';
/* eslint-disable no-unused-vars */

const LINE_TYPE_LABELS = {
  mobile:   { label: '📱 Móvel',     color: '#16a34a' },
  landline: { label: '☎ Fixo',       color: '#6b7280' },
  voip:     { label: '💻 VoIP',      color: '#3b82f6' },
  unknown:  { label: '❓ Desconhecido',color: '#9ca3af' },
  null:     { label: '—',            color: '#d1d5db' },
};

// ── Lookup Modal ─────────────────────────────────────────────────────────────
function LookupModal({ list, onClose }) {
  const [estimate, setEstimate] = useState(null);
  const [running, setRunning]   = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [results, setResults]   = useState([]);
  const [summary, setSummary]   = useState([]);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  useEffect(() => {
    api.lookupEstimate(list.id)
      .then(r => setEstimate(r.data))
      .catch(e => setError(e.response?.data?.error || 'Erro ao estimar'));
  }, [list.id]);

  function runLookup() {
    setRunning(true); setError(''); setResults([]);
    const token = localStorage.getItem('maiver_token');
    const es = new EventSource(`/api/lists/${list.id}/lookup?token=${token}`);

    // EventSource doesn't support custom headers natively — use fetch SSE instead
    es.close();

    // Use fetch with ReadableStream for SSE with auth header
    const ctrl = new AbortController();
    fetch(`/api/lists/${list.id}/lookup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    }).then(async res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === 'progress') {
              setProgress({ done: msg.done, total: msg.total });
              setResults(prev => [...prev.slice(-49), { phone: msg.phone, valid: msg.valid, line_type: msg.line_type }]);
            } else if (msg.type === 'done') {
              setDone(true); setRunning(false);
              api.lookupResults(list.id).then(r => setSummary(r.data.summary));
            } else if (msg.type === 'error') {
              setError(msg.message); setRunning(false);
            }
          } catch {}
        }
      }
    }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setRunning(false); } });

    return () => ctrl.abort();
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="modal-backdrop" onClick={e => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <h2 className="modal-title">🔍 Phone Lookup — {list.name}</h2>

        {error && <div className="alert alert-error">{error}</div>}

        {!running && !done && estimate && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {[
                ['Contatos', estimate.contactCount.toLocaleString('pt-BR')],
                ['Custo por lookup', `$${estimate.perLookup.toFixed(4)}`],
                ['Custo total', `$${estimate.totalCost.toFixed(4)}`],
                ['Saldo disponível', `$${Number(estimate.balance).toFixed(4)}`],
              ].map(([label, value]) => (
                <div key={label} style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
            {!estimate.sufficient && (
              <div className="alert alert-error">Saldo insuficiente para executar o lookup.</div>
            )}
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              O lookup valida cada número e identifica o tipo de linha (móvel, fixo, VoIP). Útil para filtrar listas e reduzir custos de campanha.
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" onClick={runLookup} disabled={!estimate.sufficient}>
                🔍 Executar Lookup (${estimate.totalCost.toFixed(4)})
              </button>
            </div>
          </>
        )}

        {running && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span>Processando...</span>
                <span style={{ fontFamily: 'monospace' }}>{progress?.done || 0} / {progress?.total || 0}</span>
              </div>
              <div style={{ background: '#e5e7eb', borderRadius: 999, height: 8 }}>
                <div style={{ background: 'var(--primary)', borderRadius: 999, height: 8, width: `${pct}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 12, fontFamily: 'monospace', background: '#f9fafb', borderRadius: 6, padding: 8 }}>
              {results.slice(-10).reverse().map((r, i) => (
                <div key={i} style={{ color: r.valid ? '#16a34a' : '#ef4444', padding: '1px 0' }}>
                  {r.phone} → {r.line_type || 'unknown'} {r.valid ? '✓' : '✕'}
                </div>
              ))}
            </div>
          </div>
        )}

        {done && (
          <>
            <div className="alert alert-success">✅ Lookup concluído!</div>
            {summary.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                {summary.map(s => {
                  const meta = LINE_TYPE_LABELS[s.line_type] || LINE_TYPE_LABELS['unknown'];
                  return (
                    <div key={s.line_type} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: meta.color, fontWeight: 600 }}>{meta.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{s.count}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="modal-footer" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={onClose}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Upload modal (2 steps) ───────────────────────────────────────────────────
function UploadModal({ onClose, onImported }) {
  const [step, setStep] = useState(1); // 1=upload, 2=configure
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { columns, preview, total }
  const [listName, setListName] = useState('');
  const [phoneColumn, setPhoneColumn] = useState('');
  const [countryCode, setCountryCode] = useState('+55');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef();

  async function handleFile(f) {
    if (!f) return;
    setFile(f);
    setError('');
    setLoading(true);
    try {
      const { data } = await api.preview(f);
      setPreview(data);
      setListName(f.name.replace(/\.[^.]+$/, ''));
      // Auto-select phone column heuristic
      const phoneCol = data.columns.find((c) =>
        /telefon|phone|celular|whatsapp|fone|tel\b/i.test(c)
      );
      if (phoneCol) setPhoneColumn(phoneCol);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao ler arquivo');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!listName || !phoneColumn) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.import(file, listName, phoneColumn, countryCode);
      onImported(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao importar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <h2 className="modal-title">
          {step === 1 ? 'Importar CSV' : `Configurar lista — ${preview?.total} contatos`}
        </h2>

        {error && <div className="alert alert-error">{error}</div>}

        {step === 1 && (
          <div
            style={{
              border: '2px dashed #e5e7eb', borderRadius: 8, padding: 40,
              textAlign: 'center', cursor: 'pointer', background: '#f9fafb',
            }}
            onClick={() => inputRef.current.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          >
            <div style={{ fontSize: 32 }}>📂</div>
            <p style={{ marginTop: 8, color: '#6b7280' }}>Arraste o CSV aqui ou clique para selecionar</p>
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Suporta vírgula (,) e ponto-e-vírgula (;)</p>
            <input ref={inputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])} />
          </div>
        )}

        {step === 2 && preview && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>Nome da lista *</label>
                <input value={listName} onChange={(e) => setListName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Código do país</label>
                <input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} placeholder="+55" />
              </div>
            </div>

            <div className="form-group">
              <label>Coluna do telefone *</label>
              <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)}>
                <option value="">Selecione...</option>
                {preview.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                Colunas detectadas ({preview.columns.length}):
                <span style={{ color: '#4f46e5', fontWeight: 600 }}>
                  {' '}{preview.columns.join(' · ')}
                </span>
              </p>
            </div>

            {/* Preview table */}
            <div style={{ overflowX: 'auto', marginBottom: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c} style={{
                        padding: '6px 10px', background: '#f9fafb', textAlign: 'left',
                        borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap',
                        color: c === phoneColumn ? '#4f46e5' : '#374151',
                      }}>
                        {c === phoneColumn ? `📱 ${c}` : c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, i) => (
                    <tr key={i}>
                      {preview.columns.map((c) => (
                        <td key={c} style={{ padding: '6px 10px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                          {row[c] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: '#9ca3af' }}>Mostrando {preview.preview.length} de {preview.total} linhas</p>
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={step === 2 ? () => setStep(1) : onClose}>
            {step === 2 ? '← Voltar' : 'Cancelar'}
          </button>
          {step === 2 && (
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={loading || !listName || !phoneColumn}
            >
              {loading ? 'Importando...' : `Importar ${preview?.total} contatos`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Contacts drawer ──────────────────────────────────────────────────────────
function ContactsDrawer({ list, onClose }) {
  const [data, setData] = useState({ contacts: [], total: 0 });
  const [page, setPage] = useState(0);
  const LIMIT = 30;

  useEffect(() => {
    api.contacts(list.id, { limit: LIMIT, offset: page * LIMIT })
      .then(({ data: d }) => setData(d));
  }, [list.id, page]);

  const cols = list.columns.filter((c) => c !== list.phone_column).slice(0, 4);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 700 }}>
        <h2 className="modal-title">{list.name} — {list.contact_count} contatos</h2>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 10px', background: '#f9fafb', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Telefone</th>
                {cols.map((c) => (
                  <th key={c} style={{ padding: '8px 10px', background: '#f9fafb', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>{c.phone}</td>
                  {cols.map((col) => (
                    <td key={col} style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{c.data[col] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.total > LIMIT && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Anterior</button>
            <span style={{ lineHeight: '28px', fontSize: 12, color: '#6b7280' }}>
              {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, data.total)} de {data.total}
            </span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * LIMIT >= data.total}>Próxima →</button>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ListsPage() {
  const [listData, setListData]   = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [viewList, setViewList]   = useState(null);
  const [lookupList, setLookupList] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [success, setSuccess]     = useState('');

  function load() {
    api.list().then(({ data }) => { setListData(data); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id, name) {
    if (!confirm(`Excluir lista "${name}" e todos os seus contatos?`)) return;
    try {
      await api.remove(id);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao excluir');
    }
  }

  function handleImported(result) {
    setShowUpload(false);
    setSuccess(`Lista "${result.name}" importada: ${result.contact_count} contatos (${result.skipped} ignorados)`);
    load();
    setTimeout(() => setSuccess(''), 5000);
  }

  return (
  <UserLayout>
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Listas de Contatos</h1>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}>+ Importar CSV</button>
      </div>

      {success && <div className="alert alert-success">{success}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Contatos</th>
                <th>Colunas</th>
                <th>Tel. coluna</th>
                <th>Importada em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando...</td></tr>
              ) : listData.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      <div style={{ fontSize: 32 }}>📋</div>
                      <p>Nenhuma lista importada ainda</p>
                    </div>
                  </td>
                </tr>
              ) : (
                listData.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 500 }}>{l.name}</td>
                    <td>
                      <span style={{ fontWeight: 600, color: '#4f46e5' }}>{l.contact_count.toLocaleString('pt-BR')}</span>
                    </td>
                    <td style={{ fontSize: 12, color: '#6b7280', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.columns.join(' · ')}
                    </td>
                    <td>
                      <span className="badge badge-sent">{l.phone_column}</span>
                    </td>
                    <td style={{ color: '#9ca3af', fontSize: 12 }}>
                      {new Date(l.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setViewList(l)}>Ver contatos</button>
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setLookupList(l)}>🔍 Lookup</button>
                        <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => handleDelete(l.id, l.name)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showUpload  && <UploadModal onClose={() => setShowUpload(false)} onImported={handleImported} />}
      {viewList    && <ContactsDrawer list={viewList} onClose={() => setViewList(null)} />}
      {lookupList  && <LookupModal list={lookupList} onClose={() => setLookupList(null)} />}
    </div>
  </UserLayout>
  );
}
