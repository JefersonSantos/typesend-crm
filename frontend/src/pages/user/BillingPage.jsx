import { useState, useEffect } from 'react';
import { billing as billingApi } from '../../services/api';
import UserLayout from '../../layouts/UserLayout';

const AMOUNTS = [500, 1000, 2500, 5000, 10000]; // cents

const ORDER_STATUS = {
  pending: { label: '⏳ Pendente',   cls: 'badge-queued' },
  paid:    { label: '✓ Pago',        cls: 'badge-delivered' },
  failed:  { label: '✕ Falhou',      cls: 'badge-failed' },
  expired: { label: '⌛ Expirado',   cls: 'badge-failed' },
};

const TYPE_LABEL = {
  topup:             '⬆ Recarga',
  usage:             '⬇ Uso',
  manual_adjustment: '⚙ Ajuste',
  manual_debit:      '⬇ Débito',
  refund:            '↩ Reembolso',
};
const TYPE_COLOR = {
  topup:             '#16a34a',
  usage:             '#ef4444',
  manual_adjustment: '#f59e0b',
  manual_debit:      '#ef4444',
  refund:            '#3b82f6',
};

const RESOURCE_LABELS = {
  sms_outbound: { label: '📤 SMS Enviado',  icon: '📤' },
  sms_inbound:  { label: '📥 SMS Recebido', icon: '📥' },
  api_call:     { label: '🔌 Chamada API',  icon: '🔌' },
};

export default function BillingPage() {
  const [balance, setBalance]           = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [orders, setOrders]             = useState([]);
  const [rates, setRates]               = useState([]);
  const [selected, setSelected]         = useState(1000);
  const [custom, setCustom]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [page, setPage]                 = useState(0);
  const [total, setTotal]               = useState(0);
  const [tab, setTab]                   = useState('transactions'); // 'transactions' | 'orders'
  const LIMIT = 20;

  const params = new URLSearchParams(window.location.search);
  const success   = params.get('success');
  const cancelled = params.get('cancelled');

  useEffect(() => {
    billingApi.balance().then(r => setBalance(r.data.balance));
    billingApi.rates().then(r => setRates(r.data)).catch(() => setRates([]));
    billingApi.orders({ limit: 50 }).then(r => setOrders(r.data.orders)).catch(() => {});
  }, []);

  useEffect(() => {
    billingApi.transactions({ limit: LIMIT, offset: page * LIMIT }).then(r => {
      setTransactions(r.data.transactions);
      setTotal(r.data.total);
    });
  }, [page]);

  async function handleCheckout() {
    const amount = custom ? Math.round(parseFloat(custom) * 100) : selected;
    if (!amount || amount < 100) return alert('Valor mínimo: $1.00');
    setLoading(true);
    try {
      const { data } = await billingApi.checkout(amount);
      window.location.href = data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao iniciar pagamento');
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <UserLayout>
      <div className="page">
        <div className="page-header"><h1 className="page-title">Billing & Créditos</h1></div>

        {success   && <div className="alert alert-success">✅ Pagamento confirmado! Créditos serão adicionados em instantes.</div>}
        {cancelled && <div className="alert alert-error">❌ Pagamento cancelado.</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          {/* Balance card */}
          <div className="card" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff' }}>
            <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Saldo disponível</p>
            <p style={{ fontSize: 36, fontWeight: 800 }}>${Number(balance ?? 0).toFixed(4)}</p>
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Atualizado em tempo real</p>
          </div>

          {/* Add credits */}
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Adicionar créditos</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {AMOUNTS.map(a => (
                <button key={a} onClick={() => { setSelected(a); setCustom(''); }}
                  className={`btn ${selected === a && !custom ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 13, padding: '6px 12px' }}>
                  ${(a / 100).toFixed(0)}
                </button>
              ))}
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Valor personalizado (USD)</label>
              <input type="number" min="1" step="1" placeholder="Ex: 75" value={custom}
                onChange={e => { setCustom(e.target.value); setSelected(null); }} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
              onClick={handleCheckout} disabled={loading}>
              {loading ? 'Aguarde...' : `💳 Pagar $${custom || ((selected || 0) / 100).toFixed(0)} via Stripe`}
            </button>
          </div>
        </div>

        {/* Rate card */}
        {rates.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📊 Tabela de Tarifas</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Tarifas por segmento de SMS (1 segmento = até 160 chars GSM-7 ou 70 chars Unicode).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {rates.map(r => {
                const meta = RESOURCE_LABELS[r.resource_type] || { label: r.resource_type, icon: '📦' };
                return (
                  <div key={r.resource_type} style={{
                    border: '1px solid var(--gray-200)',
                    borderRadius: 10,
                    padding: '16px 18px',
                    background: '#fafafa',
                  }}>
                    <div style={{ fontSize: 22, marginBottom: 8 }}>{meta.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                      {r.description || meta.label}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', fontFamily: 'monospace' }}>
                      ${Number(r.per_unit).toFixed(4)}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>por segmento</div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 12 }}>
              * Tarifas em USD. Campanhas com múltiplos segmentos multiplicam o custo pelo número de segmentos.
            </p>
          </div>
        )}

        {/* Transactions + Orders tabs */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8 }}>
            {[['transactions', 'Transações'], ['orders', 'Ordens de Pagamento']].map(([key, label]) => (
              <button key={key} className={`btn ${tab === key ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 13, padding: '4px 14px' }} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'transactions' && (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Tipo</th><th>Valor</th><th>Descrição</th><th>Data</th></tr></thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr><td colSpan={4}><div className="empty"><p>Sem transações ainda</p></div></td></tr>
                    ) : transactions.map(t => (
                      <tr key={t.id}>
                        <td><span style={{ fontWeight: 600, fontSize: 13, color: TYPE_COLOR[t.type] || '#374151' }}>{TYPE_LABEL[t.type] || t.type}</span></td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: t.amount > 0 ? '#16a34a' : '#ef4444' }}>
                          {t.amount > 0 ? '+' : ''}${Number(t.amount).toFixed(4)}
                        </td>
                        <td style={{ fontSize: 13, color: '#6b7280' }}>{t.description || '—'}</td>
                        <td style={{ fontSize: 12, color: '#9ca3af' }}>{new Date(t.created_at).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ padding: '12px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--gray-100)' }}>
                  <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Anterior</button>
                  <span style={{ lineHeight: '28px', fontSize: 12, color: '#6b7280' }}>Página {page + 1} de {totalPages}</span>
                  <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Próxima →</button>
                </div>
              )}
            </>
          )}

          {tab === 'orders' && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Valor</th><th>Status</th><th>Stripe Session</th></tr></thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr><td colSpan={4}><div className="empty"><p>Nenhuma ordem de pagamento ainda</p></div></td></tr>
                  ) : orders.map(o => {
                    const st = ORDER_STATUS[o.status] || { label: o.status, cls: '' };
                    return (
                      <tr key={o.id}>
                        <td style={{ fontSize: 12, color: '#9ca3af' }}>{new Date(o.created_at).toLocaleString('pt-BR')}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#374151' }}>${Number(o.amount_usd).toFixed(2)}</td>
                        <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}>{o.stripe_session_id?.slice(0, 24)}...</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </UserLayout>
  );
}
