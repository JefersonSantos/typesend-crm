import { createContext, useContext, useState, useEffect } from 'react';
import { auth as authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maiver_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('maiver_token');
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then(({ data }) => setUser(data))
      .catch(() => { localStorage.removeItem('maiver_token'); localStorage.removeItem('maiver_user'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  function login(token, userData) {
    localStorage.setItem('maiver_token', token);
    localStorage.setItem('maiver_user', JSON.stringify(userData));
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem('maiver_token');
    localStorage.removeItem('maiver_user');
    setUser(null);
  }

  const isAdmin  = user?.role === 'admin';
  const isTenant = !!user?.tenantId || !!user?.tenant;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
