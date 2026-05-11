import { useState, useEffect, useCallback } from 'react';
import { campaigns as api, lists as listsApi, templates as templatesApi, instances as instancesApi } from '../services/api';
import UserLayout from '../layouts/UserLayout';

const STATUS_MAP = {
  draft:     { label: 'Rascunho',  color: '#9ca3af', bg: '#1f2937' },
  scheduled: { label: 'Agendada',  color: '#f59e0b', bg: '#451a03' },
  sending:   { label: 'Enviando',  color: '#60a5fa', bg: '#1e3a5f' },
  completed: { label: 'Concluída', color: '#22c55e', bg: '#052e16' },
  failed:    { label: 'Falhou',    color: '#ef4444', bg: '#450a0a' },
};

const CAT_LABELS = { MARKETING: 'Marketing', UTILITY: 'Utilitária', AUTHENTICATION: 'Autenticação' };
const CAT_COLORS = { MARKETING: '#f59e0b', UTILITY: '#3b82f6', AUTHENTICATION: '#8b5cf6' };

function Badge({ status }) {
  const s = STATUS_MAP[status] || { label: status, color: '#9ca3af', bg: '#1f2937' };
  return <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: s.bg, color: s.color }}>{s.label}</span>;
}

function ProgressBar({ sent, total, opted_out_count }) {
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ background: '#1f2937', borderRadius: 99, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, background: '#25D366', height: '100%', transition: 'width 0.3s' }} />
      </div>
      <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sent}/{total} ({pct}%)</p>
      {opted_out_count > 0 && <p style={{ fontSize: 10, color: '#ef4444', margin: '1px 0 0' }}>🚫 {opted_out_count} opt-out</p>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Modal de nova campanha (4 passos)
   ───────────────────────────────────────────────────────────────────────── */
function NewCampaignModal({ onClose, onCreated }) {
  const [step, setStep]         = useState(1);
  const [allLists, setLists]    = useState([]);
  const [allTemplates, setTpls] = useState([]);
  const [myInstances, setInst]  = useState([]);
  const [listCols, setListCols] = useState([]);

  const [name, setName]                 = useState('');
  const [selectedList, setSelectedList] = useState(null);
  const [selectedTpl, setSelectedTpl]   = useState(null);
  const [selectedInst, setSelectedInst] = useState(null);
  const [varMap, setVarMap]             = useState({});
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');

  useEffect(() => {
    Promise.all([listsApi.list(), templatesApi.list({ status: 'approved' }), instancesApi.list()])
      .then(([l, t, i]) => {
        setLists(l.data);
        setTpls(t.data);
        setInst(i.data);
        if (i.data.length === 1) setSelectedInst(i.data[0]);
      });
  }, []);

  // Ao selecionar lista, carrega colunas
  useEffect(() => {
    if (!selectedList) return;
    setListCols(JSON.parse(selectedList.columns || '[]'));
  }, [selectedList]);

  function goStep2() { if (name && selectedList && selectedInst) setStep(2); }

  function goStep3() {
    if (!selectedTpl) return;
    const initial = {};
    (selectedTpl.variables || []).forEach(v => {
      const match = listCols.find(c => c.toLowerCase() === v.toLowerCase());
      initial[v] = match || '';
    });
    setVarMap(initial);
    setStep(3);
  }

  async function handleCreate() {
    setSaving(true); setError('');
    try {
      await api.create({
        name,
        list_id:      selectedList.id,
        template_id:  selectedTpl.id,
        instance_id:  selectedInst.id,
        variable_map: varMap,
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar campanha');
    } finally { setSaving(false); }
  }

  const STEP_LABELS = ['Lista & Número', 'Template', 'Variáveis'];

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 16, padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Progress */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {STEP_LABELS.map((s, i) => <div key={s} style={{ flex: 1, height: 4, borderRadius: 99, background: i < step ? '#25D366' : '#1f2937' }} />)}
        </div>
        <h2 style={{ color: '#f9fafb', fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
          {step === 1 ? 'Nova campanha — Lista e número' : step === 2 ? 'Escolha o template aprovado' : 'Mapeie as variáveis'}
        </h2>

        {error && <div style={{ background: '#450a0a', border: '1px solid #b91c1c', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 14, marginBottom: 14 }}>{error}</div>}

        {/* ── Passo 1 ── */}
        {step === 1 && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={lbl}>Nome da campanha *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Promo Black Friday" style={inp} />
            </div>

            <div>
              <label style={lbl}>Número WhatsApp (instância) *</label>
              {myInstances.length === 0 ? (
                <p style={{ color: '#ef4444', fontSize: 14 }}>Nenhum número disponível. Contate o administrador.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {myInstances.map(i => (
                    <div key={i.id} onClick={() => setSelectedInst(i)}
                      style={{ padding: '12px 16px', border: `2px solid ${selectedInst?.id === i.id ? '#25D366' : '#1f2937'}`, borderRadius: 8, cursor: 'pointer', background: selectedInst?.id === i.id ? '#052e16' : '#1a1a2e', display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 20 }}>📱</span>
                      <div>
                        <div style={{ fontWeight: 600, color: '#f9fafb', fontSize: 14 }}>{i.name}</div>
                        <div style={{ color: '#9ca3af', fontSize: 12 }}>{i.display_phone || i.id}</div>
                      </div>
                      {selectedInst?.id === i.id && <span style={{ marginLeft: 'auto', color: '#25D366' }}>✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={lbl}>Lista de contatos *</label>
              {allLists.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: 14 }}>Nenhuma lista. Importe um CSV primeiro.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {allLists.map(l => (
                    <div key={l.id} onClick={() => setSelectedList(l)}
                      style={{ padding: '12px 16px', border: `2px solid ${selectedList?.id === l.id ? '#25D366' : '#1f2937'}`, borderRadius: 8, cursor: 'pointer', background: selectedList?.id === l.id ? '#052e16' : '#1a1a2e' }}>
                      <div style={{ fontWeight: 600, color: '#f9fafb', fontSize: 14 }}>{l.name}</div>
                      <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>{Number(l.contact_count).toLocaleString('pt-BR')} contatos</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Passo 2: Template aprovado ── */}
        {step === 2 && (
          <div>
            {allTemplates.length === 0 ? (
              <div style={{ padding: 20, background: '#451a03', borderRadius: 8, textAlign: 'center' }}>
                <p style={{ color: '#fbbf24', fontSize: 14 }}>Nenhum template aprovado encontrado.</p>
                <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 6 }}>Crie templates na aba Templates e aguarde aprovação da Meta.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
                {allTemplates.map(t => (
                  <div key={t.id} onClick={() => setSelectedTpl(t)}
                    style={{ padding: '12px 16px', border: `2px solid ${selectedTpl?.id === t.id ? '#25D366' : '#1f2937'}`, borderRadius: 8, cursor: 'pointer', background: selectedTpl?.id === t.id ? '#052e16' : '#1a1a2e' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#f9fafb', fontSize: 14 }}>{t.name}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 99, fontSize: 11, color: CAT_COLORS[t.category] || '#9ca3af' }}>{CAT_LABELS[t.category] || t.category}</span>
                      <span style={{ color: '#22c55e', fontSize: 12, marginLeft: 'auto' }}>✓ Aprovado</span>
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.4 }}>{t.body?.slice(0, 120)}{t.body?.length > 120 ? '…' : ''}</div>
                    {t.variables?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                        {t.variables.map(v => <span key={v} style={{ background: '#1e1b4b', color: '#a5b4fc', padding: '1px 6px', borderRadius: 99, fontSize: 11 }}>{`{{${v}}}`}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Passo 3: Mapeamento de variáveis ── */}
        {step === 3 && (
          <div style={{ display: 'grid', gap: 14 }}>
            {(!selectedTpl?.variables?.length) ? (
              <div style={{ padding: '12px 16px', background: '#052e16', borderRadius: 8, color: '#22c55e', fontSize: 14 }}>
                ✓ Este template não tem variáveis. Pronto para criar!
              </div>
            ) : (
              <>
                <p style={{ color: '#9ca3af', fontSize: 13 }}>Mapeie as variáveis do template para colunas da lista <b style={{ color: '#d1d5db' }}>{selectedList?.name}</b>:</p>
                {selectedTpl.variables.map(v => (
                  <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ background: '#1e1b4b', color: '#a5b4fc', padding: '5px 10px', borderRadius: 99, fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{`{{${v}}}`}</span>
                    <span style={{ color: '#6b7280' }}>→</span>
                    <select value={varMap[v] || ''} onChange={e => setVarMap(m => ({ ...m, [v]: e.target.value }))} style={{ ...inp, flex: 1 }}>
                      <option value="">Selecione a coluna...</option>
                      {listCols.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid #1f2937' }}>
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} style={btn('#374151')}>
            {step === 1 ? 'Cancelar' : '← Voltar'}
          </button>
          {step < 3 ? (
            <button onClick={step === 1 ? goStep2 : goStep3}
              disabled={step === 1 ? (!name || !selectedList || !selectedInst) : !selectedTpl}
              style={btn('#25D366')}>
              Próximo →
            </button>
          ) : (
            <button onClick={handleCreate} disabled={saving} style={btn('#25D366')}>
              {saving ? 'Criando...' : `Criar campanha — ${selectedList?.contact_count?.toLocaleString('pt-BR')} contatos`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Página principal
   ───────────────────────────────────────────────────────────────────────── */
export default function CampaignsPage() {
  const [campaignList, setCampaignList] = useState([]);
  const [stats, setStats]   = useState(null);
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

  // Auto-refresh enquanto há campanhas enviando
  useEffect(() => {
    if (!campaignList.some(c => c.status === 'sending')) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [campaignList, load]);

  async function handleSend(id, name, total) {
    if (!confirm(`Enviar campanha "${name}" para ${total.toLocaleString('pt-BR')} contatos?`)) return;
    setSending(s => ({ ...s, [id]: true }));
    try { await api.send(id); load(); }
    catch (err) { alert(err.response?.data?.error || 'Erro ao iniciar envio'); }
    finally { setSending(s => ({ ...s, [id]: false })); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Excluir campanha "${name}"?`)) return;
    try { await api.remove(id); load(); }
    catch (err) { alert(err.response?.data?.error || 'Erro ao excluir'); }
  }

  return (
    <UserLayout>
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Campanhas WhatsApp</h1>
            <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Apenas templates aprovados pela Meta podem ser usados</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={{ ...btn('#374151'), padding: '8px 14px', fontSize: 16 }}>↻</button>
            <button onClick={() => setShowNew(true)} style={btn('#25D366')}>+ Nova Campanha</button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Campanhas',      value: stats.total_campaigns || 0 },
              { label: 'Mensagens',      value: (stats.total_messages || 0).toLocaleString('pt-BR') },
              { label: 'Entregues',      value: (stats.total_delivered || 0).toLocaleString('pt-BR') },
              { label: 'Custo total',    value: `$${Number(stats.total_cost || 0).toFixed(4)}` },
            ].map(s => (
              <div key={s.label} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ color: '#9ca3af', fontSize: 13 }}>{s.label}</div>
                <div style={{ color: '#f9fafb', fontSize: 22, fontWeight: 700, marginTop: 4 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabela */}
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1f2937' }}>
                {['Campanha', 'Número', 'Template', 'Status', 'Progresso', 'Custo', 'Data', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#9ca3af', borderBottom: '1px solid #374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando...</td></tr>
              ) : campaignList.length === 0 ? (
                <tr><td colSpan={8}>
                  <div style={{ textAlign: 'center', padding: 48 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🚀</div>
                    <p style={{ color: '#9ca3af' }}>Nenhuma campanha criada ainda</p>
                  </div>
                </td></tr>
              ) : campaignList.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f9fafb', fontSize: 14 }}>{c.name}</td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>{c.instance_phone || c.instance_name || '—'}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 13, color: '#d1d5db' }}>{c.template_name}</div>
                    {c.template_category && <div style={{ fontSize: 11, color: CAT_COLORS[c.template_category] || '#9ca3af' }}>{CAT_LABELS[c.template_category] || ''}</div>}
                  </td>
                  <td style={{ padding: '14px 16px' }}><Badge status={c.status} /></td>
                  <td style={{ padding: '14px 16px' }}>
                    {c.status === 'draft' ? (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>{Number(c.total).toLocaleString('pt-BR')} contatos</span>
                    ) : (
                      <ProgressBar sent={c.sent} total={c.total} opted_out_count={c.opted_out_count} />
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: 13, color: c.total_cost > 0 ? '#25D366' : '#6b7280' }}>
                    {c.total_cost > 0 ? `$${Number(c.total_cost).toFixed(4)}` : '—'}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.status === 'draft' && (
                        <button onClick={() => handleSend(c.id, c.name, c.total)} disabled={sending[c.id]} style={btn('#25D366', 'sm')}>
                          {sending[c.id] ? '...' : '▶ Enviar'}
                        </button>
                      )}
                      {c.status === 'sending' && <span style={{ fontSize: 12, color: '#60a5fa' }}>⏳ Enviando...</span>}
                      {['draft', 'completed', 'failed'].includes(c.status) && (
                        <button onClick={() => handleDelete(c.id, c.name)} style={btn('#ef4444', 'sm')}>Excluir</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showNew && <NewCampaignModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      </div>
    </UserLayout>
  );
}

/* ── styles ── */
const btn = (bg, size = 'md') => ({
  background: bg, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
  padding: size === 'sm' ? '5px 12px' : '10px 20px', fontSize: size === 'sm' ? 13 : 14,
});
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const lbl = { display: 'block', color: '#9ca3af', fontSize: 13, marginBottom: 6, fontWeight: 500 };
const inp = { width: '100%', padding: '9px 12px', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb', fontSize: 14, boxSizing: 'border-box' };
