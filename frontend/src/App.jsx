import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import LoginPage from './pages/LoginPage';

import AdminDashboard     from './pages/admin/AdminDashboard';
import TenantsPage        from './pages/admin/TenantsPage';
import AdminInstancesPage from './pages/admin/AdminInstancesPage';
import PricingPage        from './pages/admin/PricingPage';
import AdminBillingPage   from './pages/admin/AdminBillingPage';
import AdminLogsPage      from './pages/admin/AdminLogsPage';
import AdminSettingsPage  from './pages/admin/AdminSettingsPage';

import DashboardPage  from './pages/user/DashboardPage';
import BillingPage    from './pages/user/BillingPage';
import ChatPage       from './pages/user/ChatPage';
import LogsPage       from './pages/user/LogsPage';
import AISettingsPage from './pages/user/AISettingsPage';

import ListsPage      from './pages/ListsPage';
import TemplatesPage  from './pages/TemplatesPage';
import CampaignsPage  from './pages/CampaignsPage';
import HistoryPage    from './pages/HistoryPage';

function RequireAuth({ children, admin = false }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af' }}>
      Carregando...
    </div>
  );
  if (!user) return <Navigate to={admin ? '/admin/login' : '/login'} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  if (!admin && user.role === 'admin') return <Navigate to="/admin" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"       element={<LoginPage />} />
      <Route path="/admin/login" element={<LoginPage />} />

      {/* Admin */}
      <Route path="/admin"              element={<RequireAuth admin><AdminDashboard /></RequireAuth>} />
      <Route path="/admin/tenants"      element={<RequireAuth admin><TenantsPage /></RequireAuth>} />
      <Route path="/admin/instances"    element={<RequireAuth admin><AdminInstancesPage /></RequireAuth>} />
      <Route path="/admin/pricing"      element={<RequireAuth admin><PricingPage /></RequireAuth>} />
      <Route path="/admin/billing"      element={<RequireAuth admin><AdminBillingPage /></RequireAuth>} />
      <Route path="/admin/logs"         element={<RequireAuth admin><AdminLogsPage /></RequireAuth>} />
      <Route path="/admin/settings"     element={<RequireAuth admin><AdminSettingsPage /></RequireAuth>} />

      {/* User */}
      <Route path="/"            element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/lists"       element={<RequireAuth><ListsPage /></RequireAuth>} />
      <Route path="/templates"   element={<RequireAuth><TemplatesPage /></RequireAuth>} />
      <Route path="/campaigns"   element={<RequireAuth><CampaignsPage /></RequireAuth>} />
      <Route path="/history"     element={<RequireAuth><HistoryPage /></RequireAuth>} />
      <Route path="/chat"        element={<RequireAuth><ChatPage /></RequireAuth>} />
      <Route path="/billing"     element={<RequireAuth><BillingPage /></RequireAuth>} />
      <Route path="/logs"        element={<RequireAuth><LogsPage /></RequireAuth>} />
      <Route path="/ai-settings" element={<RequireAuth><AISettingsPage /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
