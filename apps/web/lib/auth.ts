import { create } from 'zustand';
import { api } from './api-client';
import { useTheme } from './theme';

interface User {
  id: string;
  email: string;
  name: string;
  timezone?: string;
  taskDefaultPriority?: string;
  taskDefaultComplexity?: number;
  taskDefaultEstimatedMinutes?: number | null;
  theme?: 'light' | 'dark' | null;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  twoFactorEnabled?: boolean;
  googleLinked?: boolean;
  hasPassword?: boolean;
}

type LoginResult =
  | { ok: true; user: User }
  | { ok: false; twofaRequired: true; challenge: string };

interface AuthState {
  user: User | null;
  loading: boolean;
  twofaPending: { challenge: string } | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyTwofa: (code: string) => Promise<{ user: User; usedRecoveryCode: boolean }>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  twofaPending: null,

  login: async (email, password) => {
    const data = await api<
      { user: User } | { twofaRequired: true; challenge: string }
    >('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if ('twofaRequired' in data) {
      set({ twofaPending: { challenge: data.challenge } });
      return { ok: false, twofaRequired: true, challenge: data.challenge };
    }
    set({ user: data.user, twofaPending: null });
    useTheme.getState().applyFromServer(data.user.theme);
    return { ok: true, user: data.user };
  },

  verifyTwofa: async (code) => {
    const challenge = get().twofaPending?.challenge;
    if (!challenge) throw new Error('No pending 2FA challenge');
    const data = await api<{ user: User; usedRecoveryCode: boolean }>(
      '/auth/2fa/verify',
      { method: 'POST', body: { challenge, code } },
    );
    set({ user: data.user, twofaPending: null });
    useTheme.getState().applyFromServer(data.user.theme);
    return data;
  },

  signup: async (email, password, name) => {
    const data = await api<{ user: User }>('/auth/signup', {
      method: 'POST',
      body: { email, password, name },
    });
    set({ user: data.user });
    useTheme.getState().applyFromServer(data.user.theme);
  },

  logout: async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    // Legacy cleanup: purge any lingering localStorage tokens from pre-cookie era.
    try {
      localStorage.removeItem('zentra_token');
      localStorage.removeItem('zentra_refresh');
    } catch { /* ignore */ }
    set({ user: null, twofaPending: null });
  },

  loadUser: async () => {
    try {
      const user = await api<User>('/auth/me');
      set({ user, loading: false });
      useTheme.getState().applyFromServer(user.theme);
    } catch {
      set({ user: null, loading: false });
    }
  },

  refreshUser: async () => {
    try {
      const user = await api<User>('/auth/me');
      set({ user });
    } catch { /* ignore */ }
  },
}));
