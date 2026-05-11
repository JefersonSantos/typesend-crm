import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function UserLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const balance = user?.tenant?.credit_balance ?? 0;

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">Zap<span style={{ color: '#25D366' }}>CRM</span></div>
        <nav>
          <NavLink to="/" end>🏠 Dashboard</NavLink>
          <NavLink to="/lists">📋 Listas</NavLink>
          <NavLink to="/templates">✏️ Modelos</NavLink>
          <NavLink to="/campaigns">🚀 Campanhas</NavLink>
          <NavLink to="/chat">💬 Chat</NavLink>
          <NavLink to="/history">📊 Histórico</NavLink>
          <NavLink to="/logs">🔍 Logs</NavLink>
          <NavLink to="/billing">💳 Billing</NavLink>
          <NavLink to="/ai-settings">🤖 IA</NavLink>
        </nav>
        <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ background: 'rgba(79,70,229,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
            <p style={{ fontSize: 11, color: '#9ca3af' }}>Saldo</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: balance > 0 ? '#4ade80' : '#f87171' }}>
              ${Number(balance).toFixed(4)}
            </p>
          </div>
          <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.tenant?.name}
          </p>
          <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>{user?.email}</p>
          <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, color: '#9ca3af', borderColor: 'rgba(255,255,255,0.1)' }} onClick={handleLogout}>Sair</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
