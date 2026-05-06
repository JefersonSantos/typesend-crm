import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

const TYPE_BADGE = { topup: 'badge-delivered', usage: 'badge-sent', manual_adjustment: 'badge-queued', manual_debit: 'badge-failed', refund: 'badge-sent' };
const TYPE_LABEL = { topup: 'Recarga', usage: 'Uso', manual_adjustment: 'Ajuste', manual_debit: 'Débito', refund: 'Reembolso' };

export default function AdminBillingPage() {
  const [data, setData] = useState({ transactions: [], total: 0 });
  const [page, setPage] = useState(0);
  const LIMIT = 30;

  useEffect(() => {
    adminApi.billing({ limit: LIMIT, offset: page * LIMIT }).then(r => setData(r.data));
  }, [page]);

  return (
    <AdminLayout>
      <div className="page">
        <div className="page-header"><h1 className="page-title">Billing Global</h1></div>
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Conta</th><th>Tipo</th><th>Valor</th><th>Descrição</th><th>Data</th></tr></thead>
              <tbody>
                {data.transactions.length === 0 ? (
                  <tr><td colSpan={5}><div className="empty"><p>Sem transações</p></div></td></tr>
                ) : data.transactions.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 500 }}>{t.tenant_name}</td>
                    <td><span className={`badge ${TYPE_BADGE[t.type] || ''}`}>{TYPE_LABEL[t.type] || t.type}</span></td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: t.amount > 0 ? '#16a34a' : '#ef4444' }}>
                      {t.amount > 0 ? '+' : ''}${Number(t.amount).toFixed(4)}
                    </td>
                    <td style={{ color: '#6b7280', fontSize: 13 }}>{t.description || '—'}</td>
                    <td style={{ fontSize: 12, color: '#9ca3af' }}>{new Date(t.created_at).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > LIMIT && (
            <div style={{ padding: '12px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Anterior</button>
              <span style={{ lineHeight: '28px', fontSize: 12, color: '#6b7280' }}>Página {page + 1}</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setPage(p => p + 1)} disabled={(page + 1) * LIMIT >= data.total}>Próxima →</button>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
