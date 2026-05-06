import { useState, useEffect } from 'react';
import { logs as logsApi } from '../../services/api';
import UserLayout from '../../layouts/UserLayout';

const LEVEL_BADGE = { info: 'badge-sent', warn: 'badge-queued', error: 'badge-failed' };
const CATS = ['', 'auth', 'campaign', 'billing', 'api', 'list', 'system'];

export default function LogsPage() {
  const [data, setData] = useState({ logs: [], total: 0 });
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    logsApi.list({ level: level || undefined, category: category || undefined, limit: LIMIT, offset: page * LIMIT })
      .then(r => setData(r.data));
  }, [level, category, page]);

  return (
    <UserLayout>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Logs do Sistema</h1>
          <button className="btn btn-ghost" onClick={() => logsApi.list({ limit: LIMIT }).then(r => setData(r.data))}>🔄 Atualizar</button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }}>Nível</label>
            <select value={level} onChange={e => { setLevel(e.target.value); setPage(0); }} style={{ padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13 }}>
              <option value="">Todos</option>
              <option value="info">Info</option>
              <option value="warn">Aviso</option>
              <option value="error">Erro</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }}>Categoria</label>
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }} style={{ padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13 }}>
              {CATS.map(c => <option key={c} value={c}>{c || 'Todas'}</option>)}
            </select>
          </div>
          <div style={{ marginLeft: 'auto', lineHeight: '52px', fontSize: 13, color: '#9ca3af' }}>
            {data.total.toLocaleString('pt-BR')} registros
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nível</th><th>Categoria</th><th>Mensagem</th><th>Data</th></tr></thead>
              <tbody>
                {data.logs.length === 0 ? (
                  <tr><td colSpan={4}><div className="empty"><div style={{ fontSize: 32 }}>📋</div><p>Sem logs</p></div></td></tr>
                ) : data.logs.map(l => (
                  <tr key={l.id}>
                    <td><span className={`badge ${LEVEL_BADGE[l.level] || ''}`}>{l.level}</span></td>
                    <td><span style={{ fontSize: 12, background: 'var(--gray-100)', padding: '2px 6px', borderRadius: 4 }}>{l.category}</span></td>
                    <td style={{ fontSize: 13, maxWidth: 500 }}>
                      {l.message}
                      {l.metadata && (
                        <code style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
                          {l.metadata.slice(0, 80)}{l.metadata.length > 80 ? '…' : ''}
                        </code>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {new Date(l.created_at).toLocaleString('pt-BR')}
                    </td>
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
    </UserLayout>
  );
}
