import { create } from 'zustand';
import { api } from './api-client';

interface User {
  id: string;
  email: string;
  name: string;
  timezone?: string;
  taskDefaultPriority?: string;
  taskDefaultComplexity?: number;
  taskDefaultEstimatedMinutes?: number | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    localStorage.setItem('zentra_token', data.accessToken);
    localStorage.setItem('zentra_refresh', data.refreshToken);
    set({ user: data.user });
  },

  signup: async (email, password, name) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: User }>('/auth/signup', {
      method: 'POST',
      body: { email, password, name },
    });
    localStorage.setItem('zentra_token', data.accessToken);
    localStorage.setItem('zentra_refresh', data.refreshToken);
    set({ user: data.user });
  },

  logout: async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    localStorage.removeItem('zentra_token');
    localStorage.removeItem('zentra_refresh');
    set({ user: null });
  },

  loadUser: async () => {
    const token = localStorage.getItem('zentra_token');
    if (!token) { set({ loading: false }); return; }
    try {
      const user = await api<User>('/auth/me');
      set({ user, loading: false });
    } catch {
      localStorage.removeItem('zentra_token');
      localStorage.removeItem('zentra_refresh');
      set({ user: null, loading: false });
    }
  },
}));
