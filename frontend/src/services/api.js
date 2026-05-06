import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('maiver_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('maiver_token');
      localStorage.removeItem('maiver_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const auth = {
  login:       (data) => api.post('/auth/login', data),
  adminLogin:  (data) => api.post('/auth/admin/login', data),
  register:    (data) => api.post('/auth/register', data),
  me:          ()     => api.get('/auth/me'),
};

export const admin = {
  dashboard:        ()         => api.get('/admin/dashboard'),
  tenants:          (search)   => api.get('/admin/tenants', { params: { search } }),
  createTenant:     (data)     => api.post('/admin/tenants', data),
  updateTenant:     (id, data) => api.put(`/admin/tenants/${id}`, data),
  tenantStats:      (id)       => api.get(`/admin/tenants/${id}/stats`),
  adjustCredits:    (id, data) => api.post(`/admin/tenants/${id}/credits`, data),
  updateTenantTwilio: (id, data) => api.put(`/admin/tenants/${id}/twilio`, data),
  clearTenantTwilio:  (id)    => api.delete(`/admin/tenants/${id}/twilio`),
  pricing:          ()         => api.get('/admin/pricing'),
  updatePricing:    (data)     => api.put('/admin/pricing', data),
  settings:         ()         => api.get('/admin/settings'),
  getSetting:       (key)      => api.get(`/admin/settings/${key}`),
  updateSettings:   (data)     => api.put('/admin/settings', data),
  billing:          (params)   => api.get('/admin/billing', { params }),
  logs:             (params)   => api.get('/admin/logs', { params }),
};

export const billing = {
  balance:      ()     => api.get('/billing/balance'),
  transactions: (p)    => api.get('/billing/transactions', { params: p }),
  orders:       (p)    => api.get('/billing/orders', { params: p }),
  checkout:     (amt)  => api.post('/billing/checkout', { amount: amt }),
  rates:        ()     => api.get('/billing/rates'),
};

export const lists = {
  preview:        (file)                         => { const fd = new FormData(); fd.append('file', file); return api.post('/lists/preview', fd); },
  import:         (file, name, phone_column, cc) => { const fd = new FormData(); fd.append('file', file); fd.append('name', name); fd.append('phone_column', phone_column); fd.append('country_code', cc); return api.post('/lists/import', fd); },
  list:           ()                             => api.get('/lists'),
  get:            (id)                           => api.get(`/lists/${id}`),
  contacts:       (id, p)                        => api.get(`/lists/${id}/contacts`, { params: p }),
  remove:         (id)                           => api.delete(`/lists/${id}`),
  segments:       (listId)                       => api.get(`/lists/${listId}/segments`),
  createSegment:  (listId, data)                 => api.post(`/lists/${listId}/segments`, data),
  deleteSegment:  (listId, segId)                => api.delete(`/lists/${listId}/segments/${segId}`),
  lookupEstimate: (id)                           => api.get(`/lists/${id}/lookup/estimate`),
  lookupResults:  (id, p)                        => api.get(`/lists/${id}/lookup/results`, { params: p }),
  // lookup run uses EventSource (SSE) — handled directly in the component
};

export const templates = {
  list:   ()            => api.get('/templates'),
  get:    (id)          => api.get(`/templates/${id}`),
  create: (data)        => api.post('/templates', data),
  update: (id, data)    => api.put(`/templates/${id}`, data),
  remove: (id)          => api.delete(`/templates/${id}`),
};

export const campaigns = {
  list:     ()         => api.get('/campaigns'),
  stats:    ()         => api.get('/campaigns/stats'),
  get:      (id)       => api.get(`/campaigns/${id}`),
  messages: (id, p)    => api.get(`/campaigns/${id}/messages`, { params: p }),
  estimate: (data)     => api.post('/campaigns/estimate', data),
  create:   (data)     => api.post('/campaigns', data),
  send:     (id)       => api.post(`/campaigns/${id}/send`),
  remove:   (id)       => api.delete(`/campaigns/${id}`),
};

export const chat = {
  conversations: ()      => api.get('/chat/conversations'),
  messages:      (id)    => api.get(`/chat/conversations/${id}/messages`),
  send:          (id, b) => api.post(`/chat/conversations/${id}/send`, { body: b }),
  unread:        ()      => api.get('/chat/unread'),
};

export const logs = {
  list: (p) => api.get('/logs', { params: p }),
};

export const ai = {
  status:     ()               => api.get('/ai/status'),
  connect:    (api_key)        => api.put('/ai/connect', { api_key }),
  disconnect: ()               => api.delete('/ai/connect'),
  suggest:    (context, tone)  => api.post('/ai/suggest', { context, tone }),
  improve:    (body, goal)     => api.post('/ai/improve', { body, goal }),
};

export default api;
