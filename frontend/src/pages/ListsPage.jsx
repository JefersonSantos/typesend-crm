import { useState, useEffect, useRef } from 'react';
import { lists as api } from '../services/api';
import UserLayout from '../layouts/UserLayout';
/* eslint-disable no-unused-vars */

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

  const cols = list.columns.filter((c) => c !== list.phone_column).slice(0, 3);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 780 }}>
        <h2 className="modal-title">{list.name} — {list.contact_count} contatos</h2>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 10px', background: '#f9fafb', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Telefone</th>
                <th style={{ padding: '8px 10px', background: '#f9fafb', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                {cols.map((c) => (
                  <th key={c} style={{ padding: '8px 10px', background: '#f9fafb', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((c) => {
                return (
                  <tr key={c.id} style={{ opacity: c.opted_out ? 0.5 : 1 }}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontFamily: 'monospace', fontSize: 12 }}>
                      {c.phone}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
                      {c.opted_out ? (
                        <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>🚫 Opt-out</span>
                      ) : (
                        <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>
                      )}
                    </td>
                    {cols.map((col) => (
                      <td key={col} style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{c.data[col] || '—'}</td>
                    ))}
                  </tr>
                );
              })}
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
    </div>
  </UserLayout>
  );
}
