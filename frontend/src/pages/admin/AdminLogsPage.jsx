import { useState, useEffect } from 'react';
import { admin as adminApi } from '../../services/api';
import AdminLayout from '../../layouts/AdminLayout';

const LEVEL_BADGE = { info: 'badge-sent', warn: 'badge-queued', error: 'badge-failed' };

export default function AdminLogsPage() {
  const [data, setData] = useState({ logs: [] });
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    adminApi.logs({ level: level || undefined, category: category || undefined, limit: 100 }).then(r => setData({ logs: r.data }));
  }, [level, category]);

  return (
    <AdminLayout>
      <div className="page">
        <div className="page-header"><h1 className="page-title">Logs do Sistema</h1></div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          {['', 'info', 'warn', 'error'].map(l => (
            <button key={l} className={`btn ${level === l ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setLevel(l)}>
              {l || 'Todos'}
            </button>
          ))}
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nível</th><th>Categoria</th><th>Mensagem</th><th>Data</th></tr></thead>
              <tbody>
                {data.logs.map(l => (
                  <tr key={l.id}>
                    <td><span className={`badge ${LEVEL_BADGE[l.level] || ''}`}>{l.level}</span></td>
                    <td><span style={{ fontSize: 12, background: 'var(--gray-100)', padding: '2px 6px', borderRadius: 4 }}>{l.category}</span></td>
                    <td style={{ fontSize: 13 }}>{l.message}</td>
                    <td style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
