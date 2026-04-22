'use client';

import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeStore {
  theme: Theme;
  toggle: () => void;
  init: () => void;
}

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: 'light',
  toggle: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('zentra-theme', next);
    set({ theme: next });
  },
  init: () => {
    const stored = localStorage.getItem('zentra-theme') as Theme | null;
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = stored ?? preferred;
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
}));
