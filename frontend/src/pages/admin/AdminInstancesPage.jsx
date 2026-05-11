import { useState, useEffect } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import { admin } from '../../services/api';

const EMPTY_FORM = {
  name: '', waba_id: '', phone_number_id: '', access_token: '',
  display_phone: '', display_name: '', tenant_id: '',
};

export default function AdminInstancesPage() {
  const [instances, setInstances] = useState([]);
  const [tenants, setTenants]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null); // instance being edited
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  async function load() {
    setLoading(true);
    try {
      const [instRes, tenRes] = await Promise.all([admin.instances(), admin.tenants()]);
      setInstances(instRes.data);
      setTenants(tenRes.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  }

  function openEdit(inst) {
    setEditing(inst);
    setForm({
      name: inst.name || '', waba_id: inst.waba_id || '',
      phone_number_id: inst.phone_number_id || '',
      access_token: '', // não pré-preencher por segurança
      display_phone: inst.display_phone || '',
      display_name:  inst.display_name  || '',
      tenant_id:     inst.tenant_id     || '',
    });
    setError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await admin.updateInstance(editing.id, form);
        // Se mudou o tenant, atribuir
        if (form.tenant_id !== editing.tenant_id) {
          await admin.assignInstance(editing.id, form.tenant_id || null);
        }
      } else {
        await admin.createInstance(form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(instanceId, tenantId) {
    try {
      await admin.assignInstance(instanceId, tenantId || null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao atribuir');
    }
  }

  async function handleDelete(inst) {
    if (!confirm(`Excluir instância "${inst.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await admin.deleteInstance(inst.id);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao excluir');
    }
  }

  const statusColor = { active: '#22c55e', inactive: '#6b7280', suspended: '#ef4444' };

  return (
    <AdminLayout>
      <div style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Instâncias WhatsApp</h1>
            <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Gerencie os números WhatsApp Business e atribua a tenants</p>
          </div>
          <button onClick={openNew} style={btnStyle('#25D366')}>+ Nova Instância</button>
        </div>

        {loading ? (
          <p style={{ color: '#9ca3af' }}>Carregando...</p>
        ) : instances.length === 0 ? (
          <div style={emptyBox}>
            <p style={{ color: '#9ca3af', fontSize: 15 }}>Nenhuma instância cadastrada.</p>
            <button onClick={openNew} style={{ ...btnStyle('#25D366'), marginTop: 12 }}>Adicionar primeira instância</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {instances.map(inst => (
              <div key={inst.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>📱</span>
                      <span style={{ fontWeight: 600, color: '#f9fafb', fontSize: 16 }}>{inst.name}</span>
                      <span style={{ ...statusBadge, background: statusColor[inst.status] || '#6b7280' }}>
                        {inst.status}
                      </span>
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
                      <span><b style={{ color: '#d1d5db' }}>Número:</b> {inst.display_phone || '—'}</span>
                      <span><b style={{ color: '#d1d5db' }}>Nome:</b> {inst.display_name || '—'}</span>
                      <span><b style={{ color: '#d1d5db' }}>WABA ID:</b> {inst.waba_id}</span>
                      <span><b style={{ color: '#d1d5db' }}>Phone ID:</b> {inst.phone_number_id}</span>
                      <span><b style={{ color: '#d1d5db' }}>Token:</b> {inst.access_token}</span>
                      <span><b style={{ color: '#d1d5db' }}>Verify Token:</b> {inst.webhook_verify_token}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => openEdit(inst)} style={btnStyle('#3b82f6', 'sm')}>Editar</button>
                    <button onClick={() => handleDelete(inst)} style={btnStyle('#ef4444', 'sm')}>Excluir</button>
                  </div>
                </div>

                {/* Atribuição de Tenant */}
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#1a1a2e', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ color: '#9ca3af', fontSize: 13, flexShrink: 0 }}>Atribuído a:</span>
                  <select
                    value={inst.tenant_id || ''}
                    onChange={e => handleAssign(inst.id, e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— Nenhum tenant —</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
                    ))}
                  </select>
                  {inst.tenant_name && (
                    <span style={{ color: '#25D366', fontSize: 13 }}>✓ {inst.tenant_name}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de criação/edição */}
        {showForm && (
          <div style={modalOverlay}>
            <div style={modalBox}>
              <h2 style={{ color: '#f9fafb', fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
                {editing ? 'Editar Instância' : 'Nova Instância WhatsApp'}
              </h2>

              {error && <div style={errorBox}>{error}</div>}

              <form onSubmit={handleSave} style={{ display: 'grid', gap: 14 }}>
                <Field label="Nome da instância *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex: Suporte BR" required />
                <Field label="WABA ID *" value={form.waba_id} onChange={v => setForm(f => ({ ...f, waba_id: v }))} placeholder="123456789012345" required />
                <Field label="Phone Number ID *" value={form.phone_number_id} onChange={v => setForm(f => ({ ...f, phone_number_id: v }))} placeholder="123456789012345" required />
                <Field
                  label={editing ? 'Access Token (deixe em branco para manter)' : 'Access Token *'}
                  value={form.access_token}
                  onChange={v => setForm(f => ({ ...f, access_token: v }))}
                  placeholder="EAAxxxxxx..."
                  required={!editing}
                  type="password"
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Número exibido" value={form.display_phone} onChange={v => setForm(f => ({ ...f, display_phone: v }))} placeholder="+55 11 99999-9999" />
                  <Field label="Nome exibido" value={form.display_name} onChange={v => setForm(f => ({ ...f, display_name: v }))} placeholder="Empresa XYZ" />
                </div>

                <div>
                  <label style={labelStyle}>Atribuir ao tenant</label>
                  <select value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))} style={{ ...selectStyle, width: '100%' }}>
                    <option value="">— Nenhum tenant (disponível para atribuição) —</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="submit" disabled={saving} style={btnStyle('#25D366')}>{saving ? 'Salvando...' : editing ? 'Atualizar' : 'Criar instância'}</button>
                  <button type="button" onClick={() => setShowForm(false)} style={btnStyle('#374151')}>Cancelar</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function Field({ label, value, onChange, placeholder, required, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        style={inputStyle}
      />
    </div>
  );
}

/* ── styles ── */
const btnStyle = (bg, size = 'md') => ({
  background: bg, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
  padding: size === 'sm' ? '6px 14px' : '10px 20px', fontSize: size === 'sm' ? 13 : 14,
});
const cardStyle = { background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '16px 20px' };
const emptyBox = { textAlign: 'center', padding: 48, background: '#111827', borderRadius: 12, border: '1px dashed #374151' };
const statusBadge = { padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, color: '#fff' };
const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox = { background: '#111827', border: '1px solid #1f2937', borderRadius: 16, padding: 32, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' };
const errorBox = { background: '#450a0a', border: '1px solid #b91c1c', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 14, marginBottom: 16 };
const labelStyle = { display: 'block', color: '#9ca3af', fontSize: 13, marginBottom: 6, fontWeight: 500 };
const inputStyle = { width: '100%', padding: '9px 12px', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb', fontSize: 14, boxSizing: 'border-box' };
const selectStyle = { padding: '8px 12px', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb', fontSize: 14, cursor: 'pointer' };
