import { useState, useEffect, useCallback } from 'react';
import { campaigns as api, lists as listsApi, templates as templatesApi } from '../services/api';
import UserLayout from '../layouts/UserLayout';

const STATUS_MAP = {
  draft:     { label: 'Rascunho',  cls: 'badge-queued' },
  sending:   { label: 'Enviando',  cls: 'badge-sending' },
  completed: { label: 'Concluída', cls: 'badge-delivered' },
  failed:    { label: 'Falhou',    cls: 'badge-failed' },
};

function StatusBadge({ status }) {
  const { label, cls } = STATUS_MAP[status] || { label: status, cls: '' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function Progress({ sent, total }) {
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
  return (
    <div style={{ width: 120 }}>
      <div style={{ background: '#e5e7eb', borderRadius: 999, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, background: '#4f46e5', height: '100%', transition: 'width 0.3s' }} />
      </div>
      <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sent}/{total} ({pct}%)</p>
    </div>
  );
}

// ── New campaign modal (3 steps) ─────────────────────────────────────────────
function NewCampaignModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [allLists, setAllLists] = useState([]);
  const [allTemplates, setAllTemplates] = useState([]);

  const [name, setName] = useState('');
  const [selectedList, setSelectedList] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [varMap, setVarMap] = useState({}); // { templateVar: listColumn }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([listsApi.list(), templatesApi.list()]).then(([l, t]) => {
      setAllLists(l.data);
      setAllTemplates(t.data);
    });
  }, []);

  // Preview rendered sample using first contact's data
  const [samplePreview, setSamplePreview] = useState('');
  useEffect(() => {
    if (!selectedTemplate || !selectedList) { setSamplePreview(''); return; }
    listsApi.contacts(selectedList.id, { limit: 1 }).then(({ data }) => {
      const contact = data.contacts[0];
      if (!contact) return;
      let body = selectedTemplate.body;
      Object.entries(varMap).forEach(([varName, col]) => {
        body = body.replaceAll(`{{${varName}}}`, contact.data[col] || `{{${varName}}}`);
      });
      setSamplePreview(body);
    });
  }, [varMap, selectedTemplate, selectedList]);

  function goStep2() {
    if (!name || !selectedList) return;
    setStep(2);
  }

  function goStep3() {
    if (!selectedTemplate) return;
    // Init varMap with auto-match (same column name)
    const initial = {};
    selectedTemplate.variables.forEach((v) => {
      const match = selectedList.columns.find(
        (c) => c.toLowerCase() === v.toLowerCase()
      );
      initial[v] = match || '';
    });
    setVarMap(initial);
    setStep(3);
  }

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.create({
        name,
        list_id: selectedList.id,
        template_id: selectedTemplate.id,
        variable_map: varMap,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar campanha');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
          {['Lista', 'Modelo', 'Variáveis'].map((s, i) => (
            <div key={s} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', margin: '0 auto 4px',
                background: step > i + 1 ? '#22c55e' : step === i + 1 ? '#4f46e5' : '#e5e7eb',
                color: step >= i + 1 ? '#fff' : '#9ca3af',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
              }}>{step > i + 1 ? '✓' : i + 1}</div>
              <p style={{ fontSize: 11, color: step === i + 1 ? '#4f46e5' : '#9ca3af' }}>{s}</p>
            </div>
          ))}
        </div>

        <h2 className="modal-title" style={{ marginBottom: 16 }}>
          {step === 1 ? 'Nova campanha — Escolha a lista' :
           step === 2 ? 'Escolha o modelo de mensagem' :
           'Mapeie as variáveis'}
        </h2>

        {error && <div className="alert alert-error">{error}</div>}

        {/* Step 1: name + list */}
        {step === 1 && (
          <>
            <div className="form-group">
              <label>Nome da campanha *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Black Friday — Clientes SP" />
            </div>
            <div className="form-group">
              <label>Lista de contatos *</label>
              {allLists.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhuma lista disponível. Importe um CSV primeiro.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                  {allLists.map((l) => (
                    <div
                      key={l.id}
                      onClick={() => setSelectedList(l)}
                      style={{
                        padding: '12px 16px', border: `2px solid ${selectedList?.id === l.id ? '#4f46e5' : '#e5e7eb'}`,
                        borderRadius: 8, cursor: 'pointer', background: selectedList?.id === l.id ? '#eef2ff' : '#fff',
                        transition: 'all 0.15s',
                      }}
                    >
                      <p style={{ fontWeight: 600, margin: 0 }}>{l.name}</p>
                      <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>
                        {l.contact_count.toLocaleString('pt-BR')} contatos · {l.columns.join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 2: template */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
            {allTemplates.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum modelo disponível. Crie um modelo primeiro.</p>
            ) : (
              allTemplates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTemplate(t)}
                  style={{
                    padding: '12px 16px', border: `2px solid ${selectedTemplate?.id === t.id ? '#4f46e5' : '#e5e7eb'}`,
                    borderRadius: 8, cursor: 'pointer', background: selectedTemplate?.id === t.id ? '#eef2ff' : '#fff',
                  }}
                >
                  <p style={{ fontWeight: 600, margin: 0 }}>{t.name}</p>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0', fontFamily: 'monospace', lineHeight: 1.5 }}>{t.body}</p>
                  {t.variables.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {t.variables.map((v) => (
                        <span key={v} style={{ background: '#ede9fe', color: '#5b21b6', padding: '1px 6px', borderRadius: 999, fontSize: 11 }}>
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Step 3: variable mapping */}
        {step === 3 && (
          <>
            {selectedTemplate.variables.length === 0 ? (
              <div className="alert alert-success">Este modelo não tem variáveis. Pronto para enviar!</div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                  Mapeie cada variável do modelo para uma coluna da lista <strong>{selectedList.name}</strong>:
                </p>
                {selectedTemplate.variables.map((v) => (
                  <div className="form-group" key={v} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <span style={{ background: '#ede9fe', color: '#5b21b6', padding: '4px 10px', borderRadius: 999, fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {`{{${v}}}`}
                    </span>
                    <span style={{ color: '#9ca3af' }}>→</span>
                    <select
                      value={varMap[v] || ''}
                      onChange={(e) => setVarMap((m) => ({ ...m, [v]: e.target.value }))}
                      style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}
                    >
                      <option value="">Selecione a coluna...</option>
                      {selectedList.columns.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </>
            )}

            {samplePreview && (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', marginTop: 8 }}>
                <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Preview (1º contato da lista)
                </p>
                <p style={{ fontSize: 13, fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>{samplePreview}</p>
              </div>
            )}
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}>
            {step === 1 ? 'Cancelar' : '← Voltar'}
          </button>
          {step < 3 ? (
            <button
              className="btn btn-primary"
              onClick={step === 1 ? goStep2 : goStep3}
              disabled={step === 1 ? (!name || !selectedList) : !selectedTemplate}
            >
              Próximo →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
              {saving ? 'Criando...' : `Criar campanha — ${selectedList?.contact_count?.toLocaleString('pt-BR')} contatos`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function CampaignsPage() {
  const [campaignList, setCampaignList] = useState([]);
  const [stats, setStats] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState({});

  const load = useCallback(() => {
    Promise.all([api.list(), api.stats()]).then(([c, s]) => {
      setCampaignList(c.data);
      setStats(s.data);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while any campaign is sending
  useEffect(() => {
    const hasSending = campaignList.some((c) => c.status === 'sending');
    if (!hasSending) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [campaignList, load]);

  async function handleSend(id, name, total) {
    if (!confirm(`Enviar campanha "${name}" para ${total.toLocaleString('pt-BR')} contatos?`)) return;
    setSending((s) => ({ ...s, [id]: true }));
    try {
      await api.send(id);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao iniciar envio');
    } finally {
      setSending((s) => ({ ...s, [id]: false }));
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Excluir campanha "${name}"?`)) return;
    try {
      await api.remove(id);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao excluir');
    }
  }

  return (
    <UserLayout>
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Campanhas</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={load}>🔄</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nova Campanha</button>
        </div>
      </div>

      {stats && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Campanhas</div>
            <div className="stat-value indigo">{stats.total_campaigns}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Mensagens enviadas</div>
            <div className="stat-value">{(stats.total_messages || 0).toLocaleString('pt-BR')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Entregues</div>
            <div className="stat-value green">{(stats.total_delivered || 0).toLocaleString('pt-BR')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Custo total (USD)</div>
            <div className="stat-value" style={{ fontSize: 22 }}>
              ${Number(stats.total_cost || 0).toFixed(4)}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Lista</th>
                <th>Modelo</th>
                <th>Status</th>
                <th>Progresso</th>
                <th>Custo</th>
                <th>Criada em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando...</td></tr>
              ) : campaignList.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      <div style={{ fontSize: 32 }}>🚀</div>
                      <p>Nenhuma campanha criada ainda</p>
                    </div>
                  </td>
                </tr>
              ) : (
                campaignList.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>{c.list_name}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>{c.template_name}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>
                      {c.status === 'draft' ? (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>{c.total.toLocaleString('pt-BR')} contatos</span>
                      ) : (
                        <Progress sent={c.sent} total={c.total} />
                      )}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {c.total_cost > 0 ? `$${Number(c.total_cost).toFixed(4)}` : '—'}
                    </td>
                    <td style={{ color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(c.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {c.status === 'draft' && (
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            disabled={sending[c.id]}
                            onClick={() => handleSend(c.id, c.name, c.total)}
                          >
                            {sending[c.id] ? '...' : '▶ Enviar'}
                          </button>
                        )}
                        {c.status === 'sending' && (
                          <span style={{ fontSize: 12, color: '#f59e0b', lineHeight: '28px' }}>⏳ Em envio...</span>
                        )}
                        {(c.status === 'draft' || c.status === 'completed' || c.status === 'failed') && (
                          <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => handleDelete(c.id, c.name)}>Excluir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewCampaignModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
    </UserLayout>
  );
}
