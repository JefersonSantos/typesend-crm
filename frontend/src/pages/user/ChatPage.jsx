import { useState, useEffect, useRef } from 'react';
import { chat as chatApi } from '../../services/api';
import UserLayout from '../../layouts/UserLayout';

export default function ChatPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef();

  useEffect(() => {
    loadConversations();
    const t = setInterval(loadConversations, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (selected) loadMessages(selected.id);
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function loadConversations() {
    chatApi.conversations().then(r => setConversations(r.data));
  }

  function loadMessages(id) {
    chatApi.messages(id).then(r => {
      setMessages(r.data.messages);
      setConversations(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c));
    });
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!newMsg.trim() || !selected) return;
    setSending(true);
    try {
      await chatApi.send(selected.id, newMsg);
      setNewMsg('');
      loadMessages(selected.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao enviar');
    } finally {
      setSending(false);
    }
  }

  return (
    <UserLayout>
      <div className="page" style={{ padding: 0, height: 'calc(100vh - 0px)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 32px 16px', borderBottom: '1px solid var(--gray-200)' }}>
          <h1 className="page-title">Chat com Clientes</h1>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Conversations list */}
          <div style={{ width: 280, borderRight: '1px solid var(--gray-200)', overflowY: 'auto', flexShrink: 0 }}>
            {conversations.length === 0 ? (
              <div className="empty" style={{ padding: 32 }}>
                <div style={{ fontSize: 32 }}>💬</div>
                <p>Sem conversas ainda</p>
                <p style={{ fontSize: 11 }}>Configure o webhook de inbound SMS no Twilio</p>
              </div>
            ) : conversations.map(c => (
              <div key={c.id} onClick={() => setSelected(c)}
                style={{
                  padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid var(--gray-100)',
                  background: selected?.id === c.id ? '#eef2ff' : '#fff',
                  transition: 'background 0.15s',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 14 }}>{c.contact_name || c.contact_phone}</p>
                    {c.contact_name && <p style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{c.contact_phone}</p>}
                  </div>
                  {c.unread_count > 0 && (
                    <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 999, fontSize: 11, padding: '2px 6px', fontWeight: 700 }}>
                      {c.unread_count}
                    </span>
                  )}
                </div>
                {c.last_message_body && (
                  <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {c.last_message_body}
                  </p>
                )}
                {c.last_message_at && (
                  <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 2 }}>
                    {new Date(c.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Messages area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {!selected ? (
              <div className="empty" style={{ flex: 1, justifyContent: 'center', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 40 }}>💬</div>
                <p>Selecione uma conversa</p>
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--gray-200)', background: '#fff' }}>
                  <p style={{ fontWeight: 700 }}>{selected.contact_name || selected.contact_phone}</p>
                  <p style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace' }}>{selected.contact_phone}</p>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--gray-50)' }}>
                  {messages.map(m => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '70%', padding: '10px 14px', borderRadius: 16,
                        background: m.direction === 'outbound' ? 'var(--primary)' : '#fff',
                        color: m.direction === 'outbound' ? '#fff' : 'var(--gray-900)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                        borderBottomRightRadius: m.direction === 'outbound' ? 4 : 16,
                        borderBottomLeftRadius: m.direction === 'inbound' ? 4 : 16,
                      }}>
                        <p style={{ fontSize: 14, lineHeight: 1.5 }}>{m.body}</p>
                        <p style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: m.direction === 'outbound' ? 'right' : 'left' }}>
                          {new Date(m.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          {m.direction === 'outbound' && ` · ${m.status}`}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>

                <form onSubmit={handleSend} style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-200)', background: '#fff', display: 'flex', gap: 8 }}>
                  <input value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Digite sua mensagem..."
                    style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--gray-200)', borderRadius: 24, outline: 'none', fontSize: 14 }} />
                  <button type="submit" className="btn btn-primary" style={{ borderRadius: 24, padding: '8px 20px' }} disabled={sending || !newMsg.trim()}>
                    {sending ? '...' : '→'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </UserLayout>
  );
}
