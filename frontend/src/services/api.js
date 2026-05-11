import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('typesend_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('typesend_token');
      localStorage.removeItem('typesend_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const auth = {
  login:      (data) => api.post('/auth/login', data),
  adminLogin: (data) => api.post('/auth/admin/login', data),
  register:   (data) => api.post('/auth/register', data),
  me:         ()     => api.get('/auth/me'),
};

export const admin = {
  // Dashboard
  dashboard:     ()         => api.get('/admin/dashboard'),

  // Tenants
  tenants:       (search)   => api.get('/admin/tenants', { params: { search } }),
  createTenant:  (data)     => api.post('/admin/tenants', data),
  updateTenant:  (id, data) => api.put(`/admin/tenants/${id}`, data),
  tenantStats:   (id)       => api.get(`/admin/tenants/${id}/stats`),
  adjustCredits: (id, data) => api.post(`/admin/tenants/${id}/credits`, data),
  updateTenantAI:(id, data) => api.put(`/admin/tenants/${id}/ai`, data),

  // Instâncias WhatsApp
  instances:        ()              => api.get('/admin/instances'),
  createInstance:   (data)          => api.post('/admin/instances', data),
  updateInstance:   (id, data)      => api.put(`/admin/instances/${id}`, data),
  assignInstance:   (id, tenant_id) => api.post(`/admin/instances/${id}/assign`, { tenant_id }),
  deleteInstance:   (id)            => api.delete(`/admin/instances/${id}`),

  // Precificação
  pricing:       ()     => api.get('/admin/pricing'),
  updatePricing: (data) => api.put('/admin/pricing', data),

  // Configurações
  settings:      ()         => api.get('/admin/settings'),
  getSetting:    (key)      => api.get(`/admin/settings/${key}`),
  updateSettings:(data)     => api.put('/admin/settings', data),

  // Billing e Logs
  billing: (params) => api.get('/admin/billing', { params }),
  logs:    (params) => api.get('/admin/logs', { params }),
};

export const billing = {
  balance:      ()    => api.get('/billing/balance'),
  transactions: (p)   => api.get('/billing/transactions', { params: p }),
  orders:       (p)   => api.get('/billing/orders', { params: p }),
  checkout:     (amt) => api.post('/billing/checkout', { amount: amt }),
  rates:        ()    => api.get('/billing/rates'),
};

export const lists = {
  preview:       (file)                         => { const fd = new FormData(); fd.append('file', file); return api.post('/lists/preview', fd); },
  import:        (file, name, phone_column, cc) => { const fd = new FormData(); fd.append('file', file); fd.append('name', name); fd.append('phone_column', phone_column); fd.append('country_code', cc); return api.post('/lists/import', fd); },
  list:          ()                             => api.get('/lists'),
  get:           (id)                           => api.get(`/lists/${id}`),
  contacts:      (id, p)                        => api.get(`/lists/${id}/contacts`, { params: p }),
  remove:        (id)                           => api.delete(`/lists/${id}`),
  segments:      (listId)                       => api.get(`/lists/${listId}/segments`),
  createSegment: (listId, data)                 => api.post(`/lists/${listId}/segments`, data),
  deleteSegment: (listId, segId)                => api.delete(`/lists/${listId}/segments/${segId}`),
};

export const templates = {
  list:   (params)    => api.get('/templates', { params }),
  get:    (id)        => api.get(`/templates/${id}`),
  create: (data)      => api.post('/templates', data),
  update: (id, data)  => api.put(`/templates/${id}`, data),
  submit: (id, data)  => api.post(`/templates/${id}/submit`, data),     // envia para Meta
  sync:   (id, data)  => api.post(`/templates/${id}/sync`, data),       // atualiza status
  remove: (id)        => api.delete(`/templates/${id}`),
};

export const campaigns = {
  list:     ()        => api.get('/campaigns'),
  stats:    ()        => api.get('/campaigns/stats'),
  get:      (id)      => api.get(`/campaigns/${id}`),
  messages: (id, p)   => api.get(`/campaigns/${id}/messages`, { params: p }),
  estimate: (data)    => api.post('/campaigns/estimate', data),
  create:   (data)    => api.post('/campaigns', data),
  send:     (id)      => api.post(`/campaigns/${id}/send`),
  remove:   (id)      => api.delete(`/campaigns/${id}`),
};

export const chat = {
  conversations:  (params) => api.get('/chat/conversations', { params }),
  messages:       (id)     => api.get(`/chat/conversations/${id}/messages`),
  send:           (id, b)  => api.post(`/chat/conversations/${id}/send`, { body: b }),
  newConversation:(data)   => api.post('/chat/conversations', data),
  unread:         ()       => api.get('/chat/unread'),
};

export const instances = {
  list: () => api.get('/instances'),
  get:  (id) => api.get(`/instances/${id}`),
};

export const logs = {
  list: (p) => api.get('/logs', { params: p }),
};

export const ai = {
  status:     ()              => api.get('/ai/status'),
  connect:    (api_key)       => api.put('/ai/connect', { api_key }),
  disconnect: ()              => api.delete('/ai/connect'),
  suggest:    (context, tone) => api.post('/ai/suggest', { context, tone }),
  improve:    (body, goal)    => api.post('/ai/improve', { body, goal }),
};

export default api;
