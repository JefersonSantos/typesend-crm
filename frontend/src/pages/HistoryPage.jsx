import { useState, useEffect, useCallback } from 'react';
import { campaigns as campaignsApi } from '../services/api';
import UserLayout from '../layouts/UserLayout';

function StatusBadge({ status }) {
  const map = {
    delivered:   { label: '✓ Entregue',  cls: 'badge-delivered' },
    sent:        { label: '↑ Enviado',   cls: 'badge-sent' },
    queued:      { label: '⏳ Na fila',   cls: 'badge-queued' },
    sending:     { label: '⏳ Enviando',  cls: 'badge-sending' },
    failed:      { label: '✕ Falhou',    cls: 'badge-failed' },
    undelivered: { label: '✕ Não entregue', cls: 'badge-failed' },
  };
  const { label, cls } = map[status] || { label: status, cls: '' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function HistoryPage() {
  const [campaignList, setCampaignList] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const LIMIT = 25;

  useEffect(() => {
    campaignsApi.list().then(({ data }) => {
      setCampaignList(data.filter((c) => c.status !== 'draft'));
      if (data.length > 0) setSelectedId(data.find((c) => c.status !== 'draft')?.id || '');
    });
  }, []);

  const loadMessages = useCallback(() => {
    if (!selectedId) return;
    setLoading(true);
    campaignsApi
      .messages(selectedId, { limit: LIMIT, offset: page * LIMIT, status: statusFilter || undefined })
      .then(({ data }) => {
        setMessages(data.messages);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [selectedId, page, statusFilter]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const selectedCampaign = campaignList.find((c) => c.id === selectedId);
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <UserLayout>
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Histórico de Envios</h1>
        <button className="btn btn-ghost" onClick={loadMessages}>🔄 Atualizar</button>
      </div>

      {/* Campaign picker */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>Campanha:</label>
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setPage(0); }}
            style={{ flex: 1, minWidth: 200, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}
          >
            <option value="">Selecione uma campanha...</option>
            {campaignList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.sent}/{c.total} enviados
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Campaign stats */}
      {selectedCampaign && (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value indigo">{selectedCampaign.total.toLocaleString('pt-BR')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Enviados</div>
            <div className="stat-value">{selectedCampaign.sent.toLocaleString('pt-BR')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Entregues</div>
            <div className="stat-value green">{selectedCampaign.delivered.toLocaleString('pt-BR')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Falhos</div>
            <div className="stat-value red">{selectedCampaign.failed_count.toLocaleString('pt-BR')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Custo (USD)</div>
            <div className="stat-value" style={{ fontSize: 20 }}>${Number(selectedCampaign.total_cost || 0).toFixed(4)}</div>
          </div>
        </div>
      )}

      {/* Messages table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['', 'delivered', 'sent', 'queued', 'failed'].map((s) => (
            <button
              key={s}
              className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => { setStatusFilter(s); setPage(0); }}
            >
              {s === '' ? 'Todos' : s === 'delivered' ? 'Entregues' : s === 'sent' ? 'Enviados' : s === 'queued' ? 'Na fila' : 'Falhos'}
            </button>
          ))}
          {total > 0 && <span style={{ lineHeight: '28px', fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{total.toLocaleString('pt-BR')} mensagens</span>}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Telefone</th>
                <th>Mensagem</th>
                <th>Status</th>
                <th>Custo</th>
                <th>Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {!selectedId ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Selecione uma campanha acima</td></tr>
              ) : loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando...</td></tr>
              ) : messages.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <div style={{ fontSize: 32 }}>📭</div>
                      <p>Nenhuma mensagem encontrada</p>
                    </div>
                  </td>
                </tr>
              ) : (
                messages.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.phone}</td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }} title={m.body}>
                      {m.body}
                    </td>
                    <td>
                      <StatusBadge status={m.status} />
                      {m.error_message && (
                        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }} title={m.error_message}>
                          {m.error_message.slice(0, 60)}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {m.cost != null ? `$${Number(m.cost).toFixed(4)}` : '—'}
                    </td>
                    <td style={{ color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(m.sent_at).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ padding: '12px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #f3f4f6' }}>
            <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Anterior</button>
            <span style={{ lineHeight: '28px', fontSize: 12, color: '#6b7280' }}>Página {page + 1} de {totalPages}</span>
            <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Próxima →</button>
          </div>
        )}
      </div>
    </div>
    </UserLayout>
  );
}
