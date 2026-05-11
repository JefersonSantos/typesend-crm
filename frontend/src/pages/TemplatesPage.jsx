import { useState, useEffect } from 'react';
import UserLayout from '../layouts/UserLayout';
import { templates, instances } from '../services/api';

/* ─────────────────────────────────────────────────────────────────────────
   Constantes Meta
   ───────────────────────────────────────────────────────────────────────── */
const CATEGORIES = [
  { value: 'MARKETING',      label: 'Marketing',    desc: 'Promoções, ofertas, novidades', color: '#f59e0b' },
  { value: 'UTILITY',        label: 'Utilitária',   desc: 'Confirmações, atualizações',   color: '#3b82f6' },
  { value: 'AUTHENTICATION', label: 'Autenticação', desc: 'OTP, verificação de conta',    color: '#8b5cf6' },
];

const LANGUAGES = [
  { value: 'pt_BR', label: 'Português (Brasil)' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'es_ES', label: 'Español' },
  { value: 'es_MX', label: 'Español (México)' },
];

const HEADER_TYPES = [
  { value: 'none',     label: 'Sem cabeçalho' },
  { value: 'text',     label: 'Texto' },
  { value: 'image',    label: 'Imagem' },
  { value: 'video',    label: 'Vídeo' },
  { value: 'document', label: 'Documento' },
];

const BUTTON_TYPES = [
  { value: 'QUICK_REPLY',  label: 'Resposta rápida' },
  { value: 'URL',          label: 'Link (URL)' },
  { value: 'PHONE_NUMBER', label: 'Ligar' },
];

const STATUS_CONFIG = {
  draft:    { label: 'Rascunho',   color: '#6b7280', bg: '#1f2937' },
  pending:  { label: 'Em análise', color: '#f59e0b', bg: '#451a03' },
  approved: { label: 'Aprovado',   color: '#22c55e', bg: '#052e16' },
  rejected: { label: 'Rejeitado',  color: '#ef4444', bg: '#450a0a' },
  paused:   { label: 'Pausado',    color: '#9ca3af', bg: '#1f2937' },
  disabled: { label: 'Desativado', color: '#6b7280', bg: '#1f2937' },
};

const EMPTY = {
  name: '', category: 'MARKETING', language: 'pt_BR',
  header_type: 'none', header_content: '',
  body: '', footer: '', buttons: [],
};

const STEPS = ['Informações', 'Cabeçalho', 'Corpo', 'Rodapé', 'Botões', 'Revisão'];

/* ─────────────────────────────────────────────────────────────────────────
   Componente principal
   ───────────────────────────────────────────────────────────────────────── */
export default function TemplatesPage() {
  const [list, setList]           = useState([]);
  const [myInstances, setInst]    = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filterStatus, setFilter] = useState('');
  const [wizard, setWizard]       = useState(null); // null | { editingId, form, step }

  async function load() {
    setLoading(true);
    try {
      const [tRes, iRes] = await Promise.all([templates.list(), instances.list()]);
      setList(tRes.data);
      setInst(iRes.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setWizard({ editingId: null, form: { ...EMPTY }, step: 0 });
  }

  function openEdit(t) {
    setWizard({
      editingId: t.id,
      form: {
        name: t.name, category: t.category, language: t.language,
        header_type: t.header_type || 'none', header_content: t.header_content || '',
        body: t.body, footer: t.footer || '',
        buttons: t.buttons || [],
      },
      step: 0,
    });
  }

  async function handleDelete(t) {
    if (!confirm(`Excluir template "${t.name}"?`)) return;
    try { await templates.remove(t.id); load(); }
    catch (err) { alert(err.response?.data?.error || 'Erro ao excluir'); }
  }

  async function handleSubmit(t) {
    if (!myInstances.length) return alert('Nenhuma instância disponível. Contate o administrador.');
    const inst = myInstances.length === 1 ? myInstances[0] : myInstances.find(i => window.confirm(`Usar instância "${i.name}" (${i.display_phone || i.id})?`));
    if (!inst) return;
    try { await templates.submit(t.id, { instance_id: inst.id }); load(); }
    catch (err) { alert(err.response?.data?.error || 'Erro ao submeter'); }
  }

  async function handleSync(t) {
    if (!myInstances.length) return alert('Nenhuma instância disponível.');
    try { await templates.sync(t.id, { instance_id: myInstances[0].id }); load(); }
    catch (err) { alert(err.response?.data?.error || 'Erro ao sincronizar'); }
  }

  const filtered = filterStatus ? list.filter(t => t.meta_status === filterStatus) : list;

  return (
    <UserLayout>
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Templates WhatsApp</h1>
            <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Templates precisam ser aprovados pela Meta antes de usar em campanhas</p>
          </div>
          <button onClick={openCreate} style={btn('#25D366')}>+ Novo Template</button>
        </div>

        {/* Filtros de status */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {[{ value: '', label: 'Todos' }, ...Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))].map(o => (
            <button key={o.value} onClick={() => setFilter(o.value)} style={{ padding: '5px 14px', borderRadius: 99, fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', background: filterStatus === o.value ? '#25D366' : '#1f2937', color: filterStatus === o.value ? '#fff' : '#9ca3af' }}>{o.label}</button>
          ))}
        </div>

        {loading ? <p style={{ color: '#9ca3af' }}>Carregando...</p> : filtered.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {filtered.map(t => (
              <TemplateCard key={t.id} t={t}
                onEdit={() => openEdit(t)}
                onDelete={() => handleDelete(t)}
                onSubmit={() => handleSubmit(t)}
                onSync={() => handleSync(t)}
              />
            ))}
          </div>
        )}

        {wizard && (
          <Wizard
            wizard={wizard} setWizard={setWizard}
            onSaved={load}
          />
        )}
      </div>
    </UserLayout>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Card de template
   ───────────────────────────────────────────────────────────────────────── */
function TemplateCard({ t, onEdit, onDelete, onSubmit, onSync }) {
  const st  = STATUS_CONFIG[t.meta_status] || STATUS_CONFIG.draft;
  const cat = CATEGORIES.find(c => c.value === t.category);
  const canEdit = ['draft', 'rejected'].includes(t.meta_status);

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: '#f9fafb', fontSize: 15 }}>{t.name}</span>
            <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: st.bg, color: st.color, border: `1px solid ${st.color}33` }}>{st.label}</span>
            {cat && <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, background: '#1f2937', color: cat.color }}>{cat.label}</span>}
            <span style={{ color: '#6b7280', fontSize: 12 }}>{LANGUAGES.find(l => l.value === t.language)?.label || t.language}</span>
          </div>

          {t.header_type !== 'none' && t.header_type && (
            <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 4 }}>
              <b style={{ color: '#9ca3af' }}>Header ({t.header_type}):</b>{' '}
              {t.header_type === 'text' ? t.header_content : `[${t.header_type}]`}
            </div>
          )}

          <div style={{ color: '#d1d5db', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 4 }}>
            {t.body?.length > 200 ? t.body.slice(0, 200) + '…' : t.body}
          </div>

          {t.footer && <div style={{ color: '#6b7280', fontSize: 13 }}>Rodapé: {t.footer}</div>}

          {t.buttons?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {t.buttons.map((b, i) => (
                <span key={i} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, background: '#1f2937', color: '#60a5fa', border: '1px solid #374151' }}>
                  {b.type === 'QUICK_REPLY' ? '↩ ' : b.type === 'URL' ? '🔗 ' : '📞 '}{b.text}
                </span>
              ))}
            </div>
          )}

          {t.rejection_reason && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#450a0a', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
              <b>Motivo da rejeição:</b> {t.rejection_reason}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canEdit && <button onClick={onEdit} style={btn('#3b82f6', 'sm')}>Editar</button>}
          {canEdit && <button onClick={onSubmit} style={btn('#25D366', 'sm')}>→ Meta</button>}
          {t.meta_status === 'pending' && <button onClick={onSync} style={btn('#f59e0b', 'sm')}>↻ Status</button>}
          <button onClick={onDelete} style={btn('#ef4444', 'sm')}>Excluir</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Wizard (6 passos + preview)
   ───────────────────────────────────────────────────────────────────────── */
function Wizard({ wizard, setWizard, onSaved }) {
  const { editingId, form, step } = wizard;
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function upd(field, value) {
    setWizard(w => ({ ...w, form: { ...w.form, [field]: value } }));
  }
  function setStep(fn) {
    setWizard(w => ({ ...w, step: typeof fn === 'function' ? fn(w.step) : fn }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      if (editingId) { await templates.update(editingId, form); }
      else           { await templates.create(form); }
      onSaved();
      setWizard(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar');
    } finally { setSaving(false); }
  }

  function addBtn() {
    if (form.buttons.length >= 3) return;
    upd('buttons', [...form.buttons, { type: 'QUICK_REPLY', text: '' }]);
  }
  function updBtn(i, f, v) {
    const b = [...form.buttons]; b[i] = { ...b[i], [f]: v }; upd('buttons', b);
  }
  function delBtn(i) { upd('buttons', form.buttons.filter((_, idx) => idx !== i)); }

  const detectedVars = [...new Set((form.body.match(/\{\{[^}]+\}\}/g) || []).map(m => m.slice(2, -2).trim()))];

  return (
    <div style={overlay}>
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 16, width: '100%', maxWidth: 820, maxHeight: '92vh', overflow: 'hidden', display: 'flex' }}>

        {/* Painel esquerdo */}
        <div style={{ flex: 1, padding: 28, display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRight: '1px solid #1f2937' }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {STEPS.map((_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i <= step ? '#25D366' : '#1f2937' }} />)}
          </div>

          <h2 style={{ color: '#f9fafb', fontSize: 17, fontWeight: 700, marginBottom: 18 }}>
            Passo {step + 1} de {STEPS.length}: {STEPS[step]}
          </h2>

          {error && <div style={{ background: '#450a0a', border: '1px solid #b91c1c', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 14, marginBottom: 14 }}>{error}</div>}

          {/* ── Step 0: Informações ── */}
          {step === 0 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={lbl}>Nome do template *<small style={{ color: '#6b7280', marginLeft: 6 }}>(minúsculas, números, _)</small></label>
                <input value={form.name} onChange={e => upd('name', e.target.value)} placeholder="ex: boas_vindas" style={inp} />
              </div>
              <div>
                <label style={lbl}>Categoria *</label>
                {CATEGORIES.map(c => (
                  <label key={c.value} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${form.category === c.value ? c.color : '#1f2937'}`, background: '#1a1a2e', marginBottom: 8 }}>
                    <input type="radio" name="cat" value={c.value} checked={form.category === c.value} onChange={e => upd('category', e.target.value)} />
                    <div><div style={{ color: c.color, fontWeight: 600, fontSize: 14 }}>{c.label}</div><div style={{ color: '#6b7280', fontSize: 12 }}>{c.desc}</div></div>
                  </label>
                ))}
              </div>
              <div>
                <label style={lbl}>Idioma *</label>
                <select value={form.language} onChange={e => upd('language', e.target.value)} style={inp}>
                  {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── Step 1: Cabeçalho ── */}
          {step === 1 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={lbl}>Tipo de cabeçalho</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {HEADER_TYPES.map(h => (
                    <label key={h.value} style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${form.header_type === h.value ? '#25D366' : '#1f2937'}`, background: '#1a1a2e' }}>
                      <input type="radio" name="ht" value={h.value} checked={form.header_type === h.value} onChange={e => upd('header_type', e.target.value)} />
                      <span style={{ color: '#d1d5db', fontSize: 14 }}>{h.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {form.header_type === 'text' && (
                <div>
                  <label style={lbl}>Texto do cabeçalho (máx. 60 chars)</label>
                  <input value={form.header_content} onChange={e => upd('header_content', e.target.value)} maxLength={60} style={inp} />
                </div>
              )}
              {['image', 'video', 'document'].includes(form.header_type) && (
                <div>
                  <label style={lbl}>URL da mídia (exemplo para aprovação Meta)</label>
                  <input value={form.header_content} onChange={e => upd('header_content', e.target.value)} placeholder="https://exemplo.com/arquivo" style={inp} />
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Corpo ── */}
          {step === 2 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={lbl}>Corpo da mensagem *<small style={{ color: '#6b7280', marginLeft: 6 }}>Use {'{{variavel}}'} para personalizar</small></label>
                <textarea value={form.body} onChange={e => upd('body', e.target.value)} rows={7} maxLength={1024}
                  placeholder={'Olá, {{nome}}! 👋\n\nSua encomenda *{{pedido}}* foi despachada.'} style={{ ...inp, resize: 'vertical' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>Variáveis: {detectedVars.length ? detectedVars.map(v => `{{${v}}}`).join(', ') : '—'}</span>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>{form.body.length}/1024</span>
                </div>
              </div>
              <div style={{ padding: '10px 14px', background: '#0f172a', borderRadius: 8, fontSize: 13, color: '#9ca3af' }}>
                <b style={{ color: '#d1d5db' }}>Formatação:</b> *negrito* · _itálico_ · ~riscado~ · `código`
              </div>
            </div>
          )}

          {/* ── Step 3: Rodapé ── */}
          {step === 3 && (
            <div>
              <label style={lbl}>Rodapé (opcional — máx. 60 chars)</label>
              <input value={form.footer} onChange={e => upd('footer', e.target.value)} maxLength={60} placeholder="Ex: Responda PARAR para cancelar" style={inp} />
              <p style={{ color: '#6b7280', fontSize: 13, marginTop: 8 }}>Aparece em fonte menor abaixo do corpo. Ideal para opt-out ou aviso legal.</p>
            </div>
          )}

          {/* ── Step 4: Botões ── */}
          {step === 4 && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ ...lbl, marginBottom: 0 }}>Botões (máx. 3)</label>
                {form.buttons.length < 3 && <button onClick={addBtn} style={btn('#374151', 'sm')}>+ Botão</button>}
              </div>
              {form.buttons.length === 0 && <p style={{ color: '#6b7280', fontSize: 14 }}>Sem botões. Adicione respostas rápidas, links ou botão de ligação.</p>}
              {form.buttons.map((b, i) => (
                <div key={i} style={{ padding: 14, background: '#1a1a2e', borderRadius: 8, border: '1px solid #1f2937' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ color: '#9ca3af', fontSize: 13 }}>Botão {i + 1}</span>
                    <button onClick={() => delBtn(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, padding: 0 }}>×</button>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div><label style={lbl}>Tipo</label>
                      <select value={b.type} onChange={e => updBtn(i, 'type', e.target.value)} style={inp}>
                        {BUTTON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div><label style={lbl}>Texto (máx. 25 chars)</label>
                      <input value={b.text} onChange={e => updBtn(i, 'text', e.target.value)} maxLength={25} style={inp} />
                    </div>
                    {b.type === 'URL' && <div><label style={lbl}>URL</label><input value={b.url || ''} onChange={e => updBtn(i, 'url', e.target.value)} placeholder="https://..." style={inp} /></div>}
                    {b.type === 'PHONE_NUMBER' && <div><label style={lbl}>Telefone</label><input value={b.phone || ''} onChange={e => updBtn(i, 'phone', e.target.value)} placeholder="+5511999999999" style={inp} /></div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Step 5: Revisão ── */}
          {step === 5 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <p style={{ color: '#9ca3af', fontSize: 14 }}>Revise antes de salvar. Depois de salvo, submeta para aprovação da Meta.</p>
              {[
                ['Nome', form.name || '—'],
                ['Categoria', CATEGORIES.find(c => c.value === form.category)?.label || form.category],
                ['Idioma', LANGUAGES.find(l => l.value === form.language)?.label || form.language],
                ['Cabeçalho', form.header_type === 'none' ? 'Sem cabeçalho' : `${form.header_type}: ${form.header_content || '—'}`],
                ['Rodapé', form.footer || '—'],
                ['Botões', form.buttons.length ? form.buttons.map(b => b.text).join(', ') : '—'],
                ['Variáveis', detectedVars.length ? detectedVars.join(', ') : '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ color: '#6b7280', fontSize: 14, minWidth: 90 }}>{k}:</span>
                  <span style={{ color: '#d1d5db', fontSize: 14 }}>{v}</span>
                </div>
              ))}
              <div>
                <span style={{ color: '#6b7280', fontSize: 14 }}>Corpo:</span>
                <div style={{ marginTop: 6, padding: '10px 14px', background: '#1a1a2e', borderRadius: 8, color: '#d1d5db', fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{form.body || '—'}</div>
              </div>
            </div>
          )}

          {/* Navegação */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid #1f2937' }}>
            <button onClick={step === 0 ? () => setWizard(null) : () => setStep(s => s - 1)} style={btn('#374151')}>
              {step === 0 ? 'Cancelar' : '← Voltar'}
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(s => s + 1)} disabled={step === 0 && !form.name.trim()} style={btn('#25D366')}>Próximo →</button>
            ) : (
              <button onClick={save} disabled={saving} style={btn('#25D366')}>
                {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar template'}
              </button>
            )}
          </div>
        </div>

        {/* Painel direito: preview */}
        <div style={{ width: 280, flexShrink: 0, padding: 24, background: '#0a0a1a', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto' }}>
          <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>Preview WhatsApp</p>
          <WhatsAppPreview form={form} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Preview mock WhatsApp
   ───────────────────────────────────────────────────────────────────────── */
function WhatsAppPreview({ form }) {
  return (
    <div style={{ width: 232, background: '#e5ddd5', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
      <div style={{ background: '#128C7E', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#075E54', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🏢</div>
        <div><div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Empresa</div><div style={{ color: '#b2dfdb', fontSize: 11 }}>online</div></div>
      </div>
      <div style={{ padding: '12px 8px', minHeight: 260, backgroundColor: '#e5ddd5' }}>
        {!form.body && form.header_type === 'none' ? (
          <p style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', marginTop: 30 }}>Preview aparece aqui</p>
        ) : (
          <>
            <div style={{ background: '#fff', borderRadius: '2px 8px 8px 8px', padding: '8px 10px', maxWidth: 196, boxShadow: '0 1px 2px rgba(0,0,0,0.15)', marginLeft: 4 }}>
              {form.header_type === 'text' && form.header_content && (
                <div style={{ fontWeight: 700, fontSize: 13, color: '#111', marginBottom: 6 }}>{form.header_content}</div>
              )}
              {form.header_type === 'image' && (
                <div style={{ width: '100%', height: 90, background: '#d1d5db', borderRadius: 4, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🖼️</div>
              )}
              {form.header_type === 'video' && (
                <div style={{ width: '100%', height: 90, background: '#1f2937', borderRadius: 4, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>▶️</div>
              )}
              {form.header_type === 'document' && (
                <div style={{ padding: '6px 8px', background: '#f3f4f6', borderRadius: 4, marginBottom: 6, fontSize: 12, display: 'flex', gap: 6 }}>📄 Documento</div>
              )}
              {form.body && (
                <div style={{ fontSize: 13, color: '#111', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {form.body.replace(/\{\{([^}]+)\}\}/g, (_, v) => `[${v}]`)}
                </div>
              )}
              {form.footer && (
                <div style={{ fontSize: 11, color: '#8a8a8a', marginTop: 4, borderTop: '1px solid #f0f0f0', paddingTop: 4 }}>{form.footer}</div>
              )}
              <div style={{ fontSize: 10, color: '#8a8a8a', textAlign: 'right', marginTop: 4 }}>Agora ✓✓</div>
            </div>
            {form.buttons?.length > 0 && (
              <div style={{ marginLeft: 4, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {form.buttons.map((b, i) => (
                  <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#128C7E', textAlign: 'center', fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                    {b.type === 'URL' ? '🔗 ' : b.type === 'PHONE_NUMBER' ? '📞 ' : '↩ '}{b.text || `Botão ${i + 1}`}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div style={{ textAlign: 'center', padding: 48, background: '#111827', borderRadius: 12, border: '1px dashed #374151' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
      <p style={{ color: '#9ca3af', fontSize: 15, marginBottom: 16 }}>Nenhum template encontrado.</p>
      <button onClick={onCreate} style={btn('#25D366')}>Criar primeiro template</button>
    </div>
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
