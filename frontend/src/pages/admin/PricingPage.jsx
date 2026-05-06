import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

const RESOURCE_LABELS = {
  sms_outbound: 'SMS Enviado',
  sms_inbound:  'SMS Recebido',
  api_call:     'Chamada de API',
};

export default function PricingPage() {
  const [pricing, setPricing] = useState([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  function load() {
    adminApi.pricing().then(r => setPricing(r.data));
  }
  useEffect(() => { load(); }, []);

  function updateField(resource_type, field, value) {
    setPricing(p =>
      p.map(row =>
        row.resource_type === resource_type
          ? { ...row, [field]: parseFloat(value) || 0 }
          : row
      )
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await adminApi.updatePricing(pricing);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Tabela de Preços</h1>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : saved ? '✓ Salvo' : 'Salvar preços'}
          </button>
        </div>

        <div className="card">
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
            Configure o custo base do Twilio e o markup cobrado do usuário. O usuário paga:{' '}
            <strong>Twilio base + Markup</strong>.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Recurso', 'Descrição', 'Custo Twilio (USD)', 'Markup (USD)', 'Total p/ usuário'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Recurso' || h === 'Descrição' ? 'left' : 'right',
                      padding: '8px 14px',
                      background: 'var(--gray-50)',
                      borderBottom: '1px solid var(--gray-200)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#374151',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pricing.map(row => {
                  const base   = row.twilio_base_cost ?? 0;
                  const markup = row.markup           ?? 0;
                  const total  = base + markup;
                  return (
                    <tr key={row.resource_type}>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--gray-100)' }}>
                        <code style={{ background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                          {row.resource_type}
                        </code>
                      </td>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--gray-100)', color: '#6b7280', fontSize: 13 }}>
                        {row.description}
                      </td>

                      {/* Twilio base cost — now editable */}
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--gray-100)', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          <span style={{ color: '#9ca3af', fontSize: 13 }}>$</span>
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={base}
                            onChange={e => updateField(row.resource_type, 'twilio_base_cost', e.target.value)}
                            style={{
                              width: 90,
                              padding: '4px 8px',
                              border: '1px solid var(--gray-200)',
                              borderRadius: 6,
                              fontFamily: 'monospace',
                              fontSize: 13,
                              textAlign: 'right',
                              background: '#fefce8',
                            }}
                          />
                        </div>
                      </td>

                      {/* Markup */}
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--gray-100)', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          <span style={{ color: '#9ca3af', fontSize: 13 }}>$</span>
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={markup}
                            onChange={e => updateField(row.resource_type, 'markup', e.target.value)}
                            style={{
                              width: 90,
                              padding: '4px 8px',
                              border: '1px solid var(--gray-200)',
                              borderRadius: 6,
                              fontFamily: 'monospace',
                              fontSize: 13,
                              textAlign: 'right',
                            }}
                          />
                        </div>
                      </td>

                      {/* Total */}
                      <td style={{
                        padding: '14px',
                        borderBottom: '1px solid var(--gray-100)',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--primary)',
                      }}>
                        ${total.toFixed(4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ background: '#fefce8', border: '1px solid #fde047' }}>
          <p style={{ fontSize: 13, color: '#854d0e' }}>
            <strong>💡 Dica:</strong> O campo "Custo Twilio" deve refletir o valor cobrado pelo Twilio na sua conta.
            O "Markup" é sua margem. Por exemplo: Twilio $0.0079 + Markup $0.005 = usuário paga $0.0129/SMS.
            Para 1.000 mensagens de 160 chars = <strong>$12,90</strong>.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
