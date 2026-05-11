import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <div className="layout">
      <aside className="sidebar sidebar-admin">
        <div className="sidebar-logo">Zap<span style={{ color: '#25D366' }}>CRM</span> <small style={{ color: '#6b7280', fontSize: 11 }}>Admin</small></div>
        <nav>
          <NavLink to="/admin" end>📊 Dashboard</NavLink>
          <NavLink to="/admin/tenants">🏢 Contas</NavLink>
          <NavLink to="/admin/instances">📱 Instâncias</NavLink>
          <NavLink to="/admin/pricing">💰 Preços</NavLink>
          <NavLink to="/admin/billing">💳 Billing</NavLink>
          <NavLink to="/admin/logs">📋 Logs</NavLink>
          <NavLink to="/admin/settings">⚙ Configurações</NavLink>
        </nav>
        <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>{user?.email}</p>
          <button className="btn btn-ghost" style={{ width: '100%', fontSize: 12, color: '#9ca3af', borderColor: 'rgba(255,255,255,0.1)' }} onClick={handleLogout}>Sair</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
