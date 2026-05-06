import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

/* ── Create Tenant Modal ─────────────────────────────────────────────────── */
function TenantModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', ownerName: '', initialCredits: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError('');
    try { await adminApi.createTenant(form); onSaved(); }
    catch (err) { setError(err.response?.data?.error || 'Erro'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Nova Conta</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label>Nome da empresa *</label><input value={form.name} onChange={e => set('name', e.target.value)} required /></div>
            <div className="form-group"><label>Nome do responsável *</label><input value={form.ownerName} onChange={e => set('ownerName', e.target.value)} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} required /></div>
            <div className="form-group"><label>Senha inicial *</label><input type="password" value={form.password} onChange={e => set('password', e.target.value)} required minLength={8} /></div>
          </div>
          <div className="form-group"><label>Crédito inicial (USD)</label><input type="number" step="0.01" min="0" value={form.initialCredits} onChange={e => set('initialCredits', e.target.value)} /></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Criando...' : 'Criar conta'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Credits Modal ───────────────────────────────────────────────────────── */
function CreditsModal({ tenant, onClose, onSaved }) {
  const [amount, setAmount]           = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving]           = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true);
    try { await adminApi.adjustCredits(tenant.id, { amount: parseFloat(amount), description }); onSaved(); }
    catch (err) { alert(err.response?.data?.error || 'Erro'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <h2 className="modal-title">Ajustar Créditos — {tenant.name}</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Saldo atual: <strong>${Number(tenant.credit_balance).toFixed(4)}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Valor (positivo = adicionar, negativo = debitar)</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="ex: 50 ou -10" />
          </div>
          <div className="form-group">
            <label>Descrição</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Motivo do ajuste" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '...' : 'Confirmar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Twilio + AI Config Modal ────────────────────────────────────────────── */
function TwilioModal({ tenant, onClose, onSaved }) {
  const [form, setForm] = useState({
    twilio_account_sid:           tenant.twilio_account_sid  || '',
    twilio_auth_token:            '',   // never pre-fill masked token
    twilio_messaging_service_sid: tenant.twilio_messaging_service_sid || '',
    webhook_url:                  tenant.webhook_url || '',
    anthropic_api_key:            '',   // never pre-fill
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [cleared, setCleared] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const hasCustomTwilio = !!(tenant.twilio_account_sid);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setError('');
    // Only send non-empty fields so we don't accidentally clear things
    const payload = {};
    if (form.twilio_account_sid.trim())           payload.twilio_account_sid           = form.twilio_account_sid.trim();
    if (form.twilio_auth_token.trim())            payload.twilio_auth_token            = form.twilio_auth_token.trim();
    if (form.twilio_messaging_service_sid.trim()) payload.twilio_messaging_service_sid = form.twilio_messaging_service_sid.trim();
    if (form.webhook_url.trim())                  payload.webhook_url                  = form.webhook_url.trim();
    if (form.anthropic_api_key.trim())            payload.anthropic_api_key            = form.anthropic_api_key.trim();

    try {
      await adminApi.updateTenantTwilio(tenant.id, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm(`Remover configuração Twilio de "${tenant.name}"? Voltará a usar as credenciais globais.`)) return;
    setSaving(true);
    try { await adminApi.clearTenantTwilio(tenant.id); setCleared(true); onSaved(); }
    catch (err) { setError(err.response?.data?.error || 'Erro'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <h2 className="modal-title">Configuração Twilio — {tenant.name}</h2>

        {hasCustomTwilio && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#166534' }}>✓ Subconta Twilio configurada</span>
            <button type="button" className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }} onClick={handleClear} disabled={saving}>
              Remover (usar global)
            </button>
          </div>
        )}

        {!hasCustomTwilio && (
          <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: '#854d0e' }}>⚠ Usando credenciais globais. Preencha abaixo para atribuir uma subconta dedicada.</span>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Account SID</label>
            <input
              value={form.twilio_account_sid}
              onChange={e => set('twilio_account_sid', e.target.value)}
              placeholder="AC..."
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>
          <div className="form-group">
            <label>Auth Token {hasCustomTwilio && <span style={{ color: '#9ca3af', fontWeight: 400 }}>(deixe em branco para manter o atual)</span>}</label>
            <input
              type="password"
              value={form.twilio_auth_token}
              onChange={e => set('twilio_auth_token', e.target.value)}
              placeholder={hasCustomTwilio ? '••••••••' : 'Cole o Auth Token'}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>
          <div className="form-group">
            <label>Messaging Service SID</label>
            <input
              value={form.twilio_messaging_service_sid}
              onChange={e => set('twilio_messaging_service_sid', e.target.value)}
              placeholder="MG..."
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>
          <div className="form-group">
            <label>Webhook URL base <span style={{ color: '#9ca3af', fontWeight: 400 }}>(ex: https://minha-api.com)</span></label>
            <input
              type="url"
              value={form.webhook_url}
              onChange={e => set('webhook_url', e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 20, paddingTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>🤖 Inteligência Artificial</p>
            <div className="form-group">
              <label>
                Anthropic API Key {tenant.anthropic_api_key && <span style={{ color: '#16a34a', fontWeight: 400 }}>✓ Configurada</span>}
                {!tenant.anthropic_api_key && <span style={{ color: '#9ca3af', fontWeight: 400 }}>(deixe vazio para usar a chave global)</span>}
              </label>
              <input
                type="password"
                value={form.anthropic_api_key}
                onChange={e => set('anthropic_api_key', e.target.value)}
                placeholder={tenant.anthropic_api_key ? '••••••••' : 'sk-ant-...'}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
const STATUS_COLORS = { active: 'badge-delivered', suspended: 'badge-queued', blocked: 'badge-failed' };

export default function TenantsPage() {
  const [tenants, setTenants]       = useState([]);
  const [search, setSearch]         = useState('');
  const [showNew, setShowNew]       = useState(false);
  const [creditModal, setCreditModal] = useState(null);
  const [twilioModal, setTwilioModal] = useState(null);
  const [loading, setLoading]       = useState(true);

  function load() {
    adminApi.tenants(search || undefined).then(r => { setTenants(r.data); setLoading(false); });
  }
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);

  async function toggleStatus(t) {
    const next = t.status === 'active' ? 'blocked' : 'active';
    if (!confirm(`${next === 'blocked' ? 'Bloquear' : 'Ativar'} conta "${t.name}"?`)) return;
    await adminApi.updateTenant(t.id, { status: next });
    load();
  }

  return (
    <AdminLayout>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Contas</h1>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="search-bar"><span>🔍</span><input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nova conta</button>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th><th>Email</th><th>Status</th>
                  <th>Saldo</th><th>Twilio</th><th>Plano</th><th>Criada em</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando...</td></tr>
                  : tenants.length === 0
                  ? <tr><td colSpan={8}><div className="empty"><div style={{ fontSize: 32 }}>🏢</div><p>Nenhuma conta</p></div></td></tr>
                  : tenants.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 500 }}>{t.name}</td>
                      <td style={{ fontSize: 12, color: '#6b7280' }}>{t.email}</td>
                      <td><span className={`badge ${STATUS_COLORS[t.status] || ''}`}>{t.status}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: t.credit_balance > 0 ? '#16a34a' : '#ef4444' }}>
                        ${Number(t.credit_balance).toFixed(4)}
                      </td>
                      <td>
                        {t.twilio_account_sid
                          ? <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', padding: '2px 7px', borderRadius: 999 }}>Subconta</span>
                          : <span style={{ fontSize: 11, color: '#9ca3af' }}>Global</span>
                        }
                      </td>
                      <td style={{ fontSize: 12 }}>{t.plan}</td>
                      <td style={{ fontSize: 12, color: '#9ca3af' }}>{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setCreditModal(t)}>💰 Créditos</button>
                          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setTwilioModal(t)}>⚙ Twilio</button>
                          <button
                            className={`btn ${t.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => toggleStatus(t)}
                          >
                            {t.status === 'active' ? 'Bloquear' : 'Ativar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>

        {showNew      && <TenantModal onClose={() => setShowNew(false)}       onSaved={() => { setShowNew(false);       load(); }} />}
        {creditModal  && <CreditsModal tenant={creditModal}  onClose={() => setCreditModal(null)}  onSaved={() => { setCreditModal(null);  load(); }} />}
        {twilioModal  && <TwilioModal  tenant={twilioModal}  onClose={() => setTwilioModal(null)}  onSaved={() => { setTwilioModal(null);  load(); }} />}
      </div>
    </AdminLayout>
  );
}
