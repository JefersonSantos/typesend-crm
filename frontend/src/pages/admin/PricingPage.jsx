import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

const RESOURCE_INFO = {
  whatsapp_marketing:      { label: 'Conversa Marketing',    icon: '📣', desc: 'Iniciada pela empresa — promoções e ofertas' },
  whatsapp_utility:        { label: 'Conversa Utilitária',   icon: '🔔', desc: 'Iniciada pela empresa — transacional (confirmações, alertas)' },
  whatsapp_authentication: { label: 'Conversa Autenticação', icon: '🔐', desc: 'OTP, verificação de conta' },
  whatsapp_service:        { label: 'Conversa de Serviço',   icon: '💬', desc: 'Iniciada pelo cliente — atendimento (gratuita pela Meta em muitas regiões)' },
  api_call:                { label: 'Chamada de API',        icon: '⚙️', desc: 'Custo de infraestrutura por chamada à API' },
};

export default function PricingPage() {
  const [pricing, setPricing] = useState([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => { adminApi.pricing().then(r => setPricing(r.data)); }, []);

  function upd(resource_type, field, value) {
    setPricing(p => p.map(row =>
      row.resource_type === resource_type ? { ...row, [field]: parseFloat(value) || 0 } : row
    ));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await adminApi.updatePricing(pricing);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  return (
    <AdminLayout>
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Tabela de Preços</h1>
            <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Configure o custo base Meta e o markup cobrado do usuário por tipo de conversa WhatsApp</p>
          </div>
          <button onClick={handleSave} disabled={saving} style={{ background: saved ? '#16a34a' : '#25D366', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            {saving ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar preços'}
          </button>
        </div>

        {/* Nota explicativa */}
        <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 12, padding: '14px 18px', marginBottom: 24 }}>
          <p style={{ color: '#93c5fd', fontSize: 14, margin: 0 }}>
            <b>💡 Como funciona:</b> A Meta cobra por conversa de 24 horas (não por mensagem). O usuário paga:{' '}
            <b>Custo Meta + Markup</b>. Os preços variam por país — configure conforme a região principal dos seus clientes.
          </p>
        </div>

        {/* Tabela */}
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1f2937' }}>
                {['Tipo de Conversa', 'Descrição', 'Custo Meta (USD)', 'Markup (USD)', 'Total p/ usuário'].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 2 ? 'right' : 'left', padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#9ca3af', borderBottom: '1px solid #374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pricing.map(row => {
                const info   = RESOURCE_INFO[row.resource_type] || { label: row.resource_type, icon: '💰', desc: row.description };
                const base   = row.meta_base_cost ?? 0;
                const markup = row.markup ?? 0;
                const total  = base + markup;
                return (
                  <tr key={row.resource_type} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{info.icon}</span>
                        <span style={{ fontWeight: 600, color: '#f9fafb', fontSize: 14 }}>{info.label}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#6b7280', fontSize: 13 }}>{info.desc}</td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <span style={{ color: '#6b7280', fontSize: 13 }}>$</span>
                        <input type="number" step="0.0001" min="0" value={base}
                          onChange={e => upd(row.resource_type, 'meta_base_cost', e.target.value)}
                          style={{ width: 90, padding: '4px 8px', border: '1px solid #374151', borderRadius: 6, fontFamily: 'monospace', fontSize: 13, textAlign: 'right', background: '#1a2744', color: '#93c5fd' }} />
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <span style={{ color: '#6b7280', fontSize: 13 }}>$</span>
                        <input type="number" step="0.0001" min="0" value={markup}
                          onChange={e => upd(row.resource_type, 'markup', e.target.value)}
                          style={{ width: 90, padding: '4px 8px', border: '1px solid #374151', borderRadius: 6, fontFamily: 'monospace', fontSize: 13, textAlign: 'right', background: '#1a2937', color: '#f9fafb' }} />
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#25D366' }}>
                      ${total.toFixed(4)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Tabela de referência Meta BR */}
        <div style={{ marginTop: 20, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 12, padding: '14px 18px' }}>
          <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
            <b style={{ color: '#d1d5db' }}>Referência Meta Brasil (preços aproximados):</b>{' '}
            Marketing ~$0.0625 · Utilitária ~$0.0080 · Autenticação ~$0.0315 · Serviço $0.00 (gratuita para usuário)
            — <a href="https://developers.facebook.com/docs/whatsapp/pricing" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Ver tabela oficial Meta</a>
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
