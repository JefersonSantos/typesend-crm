import { useState, useEffect } from 'react';
import { campaigns as campaignsApi, lists as listsApi, billing as billingApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import UserLayout from '../../layouts/UserLayout';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    campaignsApi.stats().then(r => setStats(r.data));
    billingApi.balance().then(r => setBalance(r.data.balance));
  }, []);

  return (
    <UserLayout>
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Olá, {user?.name?.split(' ')[0]} 👋</h1>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{user?.tenant?.name}</p>
          </div>
        </div>

        <div className="stat-grid">
          {[
            { label: 'Saldo disponível',     value: `$${Number(balance ?? 0).toFixed(4)}`, color: balance > 0 ? 'green' : 'red', link: '/billing' },
            { label: 'Campanhas',            value: stats?.total_campaigns ?? '—',         color: 'indigo' },
            { label: 'Mensagens enviadas',   value: (stats?.total_messages ?? 0).toLocaleString('pt-BR'), color: '' },
            { label: 'Taxa de entrega',      value: stats?.total_messages > 0 ? `${Math.round((stats.total_delivered / stats.total_messages) * 100)}%` : '—', color: 'green' },
          ].map(s => (
            <div key={s.label} className="stat-card" onClick={() => s.link && (window.location.href = s.link)} style={{ cursor: s.link ? 'pointer' : 'default' }}>
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Início rápido</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '📋', label: 'Importar lista de contatos', href: '/lists' },
                { icon: '✏️', label: 'Criar modelo de mensagem', href: '/templates' },
                { icon: '🚀', label: 'Criar campanha WhatsApp', href: '/campaigns' },
                { icon: '💳', label: 'Adicionar créditos', href: '/billing' },
              ].map(item => (
                <a key={item.label} href={item.href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 14, color: 'var(--gray-700)', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#eef2ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--gray-50)'}
                >
                  <span style={{ fontSize: 18 }}>{item.icon}</span> {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Resumo financeiro</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <span style={{ fontSize: 13, color: '#6b7280' }}>Custo total de campanhas</span>
                <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>${Number(stats?.total_cost ?? 0).toFixed(4)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <span style={{ fontSize: 13, color: '#6b7280' }}>Falhas</span>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#ef4444' }}>{stats?.total_failed ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ fontSize: 13, color: '#6b7280' }}>Saldo atual</span>
                <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: balance > 0 ? '#16a34a' : '#ef4444' }}>${Number(balance ?? 0).toFixed(4)}</span>
              </div>
              <a href="/billing" className="btn btn-primary" style={{ marginTop: 8, justifyContent: 'center' }}>+ Adicionar créditos</a>
            </div>
          </div>
        </div>
      </div>
    </UserLayout>
  );
}
