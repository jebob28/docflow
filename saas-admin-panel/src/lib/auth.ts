import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include the JWT token in all requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle unauthorized errors (401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authService = {
  async login(credentials: { email: string; password: string }) {
    // Note: In a real scenario, this matches the backend endpoint
    const response = await api.post('/admin/login', credentials);
    const { token, user } = response.data;
    
    if (token) {
      localStorage.setItem('admin_token', token);
      if (user) {
        localStorage.setItem('admin_user', JSON.stringify(user));
      } else {
        localStorage.setItem('admin_user', JSON.stringify({ name: 'Administrador' }));
      }
    }
    
    return response.data;
  },
  
  logout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/login';
  },
  
  isAuthenticated() {
    return !!localStorage.getItem('admin_token');
  },
  
  getUser() {
    const userStr = localStorage.getItem('admin_user');
    if (!userStr || userStr === 'undefined') return null;
    try {
      return JSON.parse(userStr);
    } catch (e) {
      console.error('Error parsing user data:', e);
      localStorage.removeItem('admin_user');
      return null;
    }
  }
};
