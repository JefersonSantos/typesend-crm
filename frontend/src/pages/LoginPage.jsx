import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth as authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname === '/admin/login';

  const [tab, setTab] = useState('login'); // login | register
  const [form, setForm] = useState({ email: '', password: '', name: '', tenantName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      let res;
      if (isAdmin) {
        res = await authApi.adminLogin({ email: form.email, password: form.password });
      } else if (tab === 'login') {
        res = await authApi.login({ email: form.email, password: form.password });
      } else {
        res = await authApi.register({ email: form.email, password: form.password, name: form.name, tenantName: form.tenantName });
      }
      login(res.data.token, res.data.user);
      navigate(isAdmin ? '/admin' : '/');
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao autenticar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gray-50)' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--gray-900)' }}>
            SMS <span style={{ color: 'var(--primary)' }}>CRM</span>
          </h1>
          <p style={{ color: 'var(--gray-600)', marginTop: 4, fontSize: 14 }}>
            {isAdmin ? 'Painel Administrativo' : 'Plataforma de SMS Marketing'}
          </p>
        </div>

        <div className="card">
          {!isAdmin && (
            <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid var(--gray-200)' }}>
              {['login', 'register'].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer',
                  fontWeight: tab === t ? 700 : 400, color: tab === t ? 'var(--primary)' : 'var(--gray-600)',
                  borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
                  fontSize: 14, transition: 'all 0.15s',
                }}>
                  {t === 'login' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            {tab === 'register' && !isAdmin && (
              <>
                <div className="form-group">
                  <label>Nome da empresa *</label>
                  <input value={form.tenantName} onChange={e => set('tenantName', e.target.value)} required placeholder="Minha Empresa Ltda" />
                </div>
                <div className="form-group">
                  <label>Seu nome *</label>
                  <input value={form.name} onChange={e => set('name', e.target.value)} required placeholder="João Silva" />
                </div>
              </>
            )}
            <div className="form-group">
              <label>Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required placeholder="email@empresa.com" />
            </div>
            <div className="form-group">
              <label>Senha *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required placeholder="••••••••" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Aguarde...' : isAdmin ? 'Entrar como Admin' : tab === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          {!isAdmin && (
            <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--gray-400)' }}>
              <a href="/admin/login" style={{ color: 'var(--gray-400)' }}>Acesso administrativo</a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
