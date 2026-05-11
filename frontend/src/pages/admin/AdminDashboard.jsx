import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  useEffect(() => { adminApi.dashboard().then(r => setData(r.data)); }, []);
  if (!data) return <AdminLayout><div className="page"><p style={{ color: '#9ca3af' }}>Carregando...</p></div></AdminLayout>;

  const { stats, recentTenants, msgPerDay } = data;

  return (
    <AdminLayout>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Dashboard Admin</h1>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>Typesend CRM — WhatsApp Platform</span>
        </div>

        <div className="stat-grid">
          {[
            { label: 'Contas Ativas',    value: stats.tenants_active,  color: 'green' },
            { label: 'Total Contas',     value: stats.tenants,         color: 'indigo' },
            { label: 'Msgs Enviadas',    value: (stats.total_messages || 0).toLocaleString('pt-BR'), color: '' },
            { label: 'Receita Total',    value: `$${Number(stats.total_revenue).toFixed(2)}`, color: 'green' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Recent tenants */}
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Últimas contas</h3>
            {recentTenants.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <div>
                  <p style={{ fontWeight: 500, fontSize: 14 }}>{t.name}</p>
                  <p style={{ fontSize: 12, color: '#9ca3af' }}>{t.email}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`badge badge-${t.status === 'active' ? 'delivered' : t.status === 'suspended' ? 'queued' : 'failed'}`}>{t.status}</span>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>${Number(t.credit_balance).toFixed(2)}</p>
                </div>
              </div>
            ))}
            <a href="/admin/tenants" style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 13, color: 'var(--primary)' }}>Ver todas →</a>
          </div>

          {/* Messages per day */}
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Mensagens (últimos 7 dias)</h3>
            {msgPerDay.length === 0 ? (
              <div className="empty"><p>Sem dados ainda</p></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msgPerDay.map(d => {
                  const max = Math.max(...msgPerDay.map(x => x.count));
                  const pct = max > 0 ? (d.count / max) * 100 : 0;
                  return (
                    <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: '#9ca3af', width: 70, flexShrink: 0 }}>
                        {new Date(d.day + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', day: '2-digit' })}
                      </span>
                      <div style={{ flex: 1, background: 'var(--gray-100)', borderRadius: 4, height: 18, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, background: 'var(--primary)', height: '100%', borderRadius: 4, transition: 'width 0.5s' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, width: 40, textAlign: 'right' }}>{d.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
