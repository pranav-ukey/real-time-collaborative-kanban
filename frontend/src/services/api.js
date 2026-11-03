import axios from 'axios';
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const tenantId = localStorage.getItem('tenantId');
  if (tenantId) config.headers['x-tenant-id'] = tenantId;
  return config;
});
export function getError(error) { return error.response?.data?.error || error.message || 'Something went wrong'; }
