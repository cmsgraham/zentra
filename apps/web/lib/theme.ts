'use client';

import { create } from 'zustand';
import { api } from './api-client';

type Theme = 'light' | 'dark';

interface ThemeStore {
  theme: Theme;
  /** Toggle light/dark. Persists to localStorage AND (if logged in) to the server. */
  toggle: () => void;
  /** Read stored / system theme and apply to <html>. Called once on app boot. */
  init: () => void;
  /** Apply an explicit theme from the user profile (called after loadUser). */
  applyFromServer: (theme: Theme | null | undefined) => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('zentra-theme', theme);
}

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: 'light',
  toggle: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    set({ theme: next });
    // Persist to server so the preference follows the account across devices.
    // Fire-and-forget — server returns 401 when not authenticated, which we ignore.
    api('/auth/me', { method: 'PATCH', body: { theme: next } }).catch(() => {});
  },
  init: () => {
    const stored = localStorage.getItem('zentra-theme') as Theme | null;
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = stored ?? preferred;
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  applyFromServer: (theme) => {
    if (theme !== 'light' && theme !== 'dark') return;
    if (get().theme === theme) return;
    applyTheme(theme);
    set({ theme });
  },
}));
