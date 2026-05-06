import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

/* Keys grouped into sections */
const SECTIONS = [
  {
    title: '🔗 Twilio Global',
    description: 'Credenciais padrão utilizadas quando o tenant não tem subconta configurada.',
    keys: [
      { key: 'twilio_account_sid',           label: 'Account SID',          type: 'text',     mono: true },
      { key: 'twilio_auth_token',            label: 'Auth Token',           type: 'password', mono: true, sensitive: true },
      { key: 'twilio_messaging_service_sid', label: 'Messaging Service SID',type: 'text',     mono: true },
      { key: 'webhook_base_url',             label: 'Webhook Base URL',     type: 'url' },
      { key: 'webhook_validate_signature',   label: 'Validar assinatura Twilio nos webhooks', type: 'toggle' },
    ],
  },
  {
    title: '💳 Stripe',
    description: 'Chaves de integração para recarga de créditos via Stripe.',
    keys: [
      { key: 'stripe_secret_key',      label: 'Secret Key (sk_...)',       type: 'password', mono: true, sensitive: true },
      { key: 'stripe_publishable_key', label: 'Publishable Key (pk_...)',  type: 'text',     mono: true },
      { key: 'stripe_webhook_secret',  label: 'Webhook Secret (whsec_...)',type: 'password', mono: true, sensitive: true },
    ],
  },
  {
    title: '💰 Billing',
    description: 'Regras de cobrança e exibição de tarifas.',
    keys: [
      { key: 'billing_min_topup_usd',       label: 'Recarga mínima (USD)',                     type: 'number' },
      { key: 'billing_auto_suspend_usd',    label: 'Suspender quando saldo < (USD, 0=desativado)', type: 'number' },
      { key: 'billing_show_rates_to_users', label: 'Mostrar tabela de tarifas para usuários',  type: 'toggle' },
      { key: 'frontend_url',               label: 'URL do Frontend (para redirect Stripe)',    type: 'url' },
    ],
  },
  {
    title: '🤖 Inteligência Artificial (Claude)',
    description: 'Chave global da Anthropic usada quando o tenant não tem chave própria. Cada tenant pode conectar a sua própria chave em Configurações.',
    keys: [
      { key: 'anthropic_api_key', label: 'Anthropic API Key global (sk-ant-...)', type: 'password', mono: true, sensitive: true },
      { key: 'anthropic_model',   label: 'Modelo padrão',                         type: 'select',
        options: [
          { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001 — Haiku 4.5 (rápido, econômico)' },
          { value: 'claude-sonnet-4-6',         label: 'claude-sonnet-4-6 — Sonnet 4.6 (balanceado)' },
          { value: 'claude-opus-4-7',           label: 'claude-opus-4-7 — Opus 4.7 (máxima capacidade)' },
        ],
      },
    ],
  },
];

export default function AdminSettingsPage() {
  // form state: { key: value }
  const [form, setForm]     = useState({});
  const [revealed, setRevealed] = useState({}); // which password fields are shown
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    // Load raw values for all keys so the form can pre-fill them
    const allKeys = SECTIONS.flatMap(s => s.keys.map(k => k.key));
    Promise.all(allKeys.map(k => adminApi.getSetting(k).then(r => [k, r.data.value]).catch(() => [k, ''])))
      .then(entries => {
        setForm(Object.fromEntries(entries));
        setLoading(false);
      });
  }, []);

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false);
    try {
      // Don't send sensitive fields that are still masked (user didn't edit them)
      const payload = { ...form };
      await adminApi.updateSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <AdminLayout>
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: '#9ca3af' }}>
        Carregando configurações...
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Configurações do Sistema</h1>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar tudo'}
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {SECTIONS.map(section => (
          <div key={section.title} className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{section.title}</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>{section.description}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {section.keys.map(field => (
                <div key={field.key} className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ marginBottom: 6 }}>{field.label}</label>

                  {field.type === 'select' ? (
                    <select
                      value={form[field.key] || ''}
                      onChange={e => set(field.key, e.target.value)}
                      style={{ fontFamily: field.mono ? 'monospace' : undefined, fontSize: 13 }}
                    >
                      {field.options.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : field.type === 'toggle' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 400, margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={form[field.key] === '1'}
                          onChange={e => set(field.key, e.target.checked ? '1' : '0')}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 13, color: '#374151' }}>
                          {form[field.key] === '1' ? 'Ativado' : 'Desativado'}
                        </span>
                      </label>
                    </div>
                  ) : field.type === 'password' ? (
                    <div style={{ position: 'relative' }}>
                      <input
                        type={revealed[field.key] ? 'text' : 'password'}
                        value={form[field.key] || ''}
                        onChange={e => set(field.key, e.target.value)}
                        placeholder={`Cole o ${field.label}`}
                        style={{ fontFamily: field.mono ? 'monospace' : undefined, fontSize: 13, paddingRight: 80 }}
                      />
                      <button
                        type="button"
                        onClick={() => setRevealed(r => ({ ...r, [field.key]: !r[field.key] }))}
                        style={{
                          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b7280',
                        }}
                      >
                        {revealed[field.key] ? '🙈 Ocultar' : '👁 Mostrar'}
                      </button>
                    </div>
                  ) : (
                    <input
                      type={field.type}
                      value={form[field.key] || ''}
                      onChange={e => set(field.key, e.target.value)}
                      step={field.type === 'number' ? '0.01' : undefined}
                      min={field.type === 'number' ? '0' : undefined}
                      style={{ fontFamily: field.mono ? 'monospace' : undefined, fontSize: 13 }}
                    />
                  )}

                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, fontFamily: 'monospace' }}>
                    {field.key}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 32 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 160 }}>
            {saving ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar configurações'}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
