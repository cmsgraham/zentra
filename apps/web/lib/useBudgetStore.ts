'use client';

import { create } from 'zustand';
import { api } from './api-client';

export type BudgetCadence = 'monthly' | 'semi_monthly' | 'none';
export type TemplateRecurrence = 'monthly' | 'weekly' | 'biweekly' | 'manual';
export type TemplatePeriodSlot = 'first' | 'second' | 'both' | 'manual';
export type BudgetEntryType = 'planned' | 'unplanned';

export interface BudgetPeriod {
  id: string;
  spaceId: string;
  label: string;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  periodIndex: number | null;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetSpaceSummary {
  plannedCount: number;
  unplannedCount: number;
  unpaidCount: number;
  totalAmount: number;
}

export interface BudgetSpace {
  id: string;
  ownerUserId?: string;
  ownerName?: string;
  isOwner?: boolean;
  name: string;
  cadence: BudgetCadence;
  exchangeRate?: number;
  autoExchangeRate?: boolean;
  includeInMonthly?: boolean;
  createdAt: string;
  updatedAt: string;
  currentPeriod?: BudgetPeriod;
  summary?: BudgetSpaceSummary;
  members?: { userId: string; name: string; email: string; role: string }[];
  library?: ExpenseTemplate[];
}

export interface ExpenseTemplate {
  id: string;
  spaceId: string;
  name: string;
  defaultAmount: number;
  recurrence: TemplateRecurrence;
  defaultPeriodSlot: TemplatePeriodSlot;
  dueDay: number | null;
  active: boolean;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetItem {
  id: string;
  periodId: string;
  templateId: string | null;
  name: string;
  amount: number;
  paid: boolean;
  entryType: BudgetEntryType;
  dueDay: number | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: string;
  spaceId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface BudgetStoreState {
  spaces: BudgetSpace[];
  loadingSpaces: boolean;
  loadSpaces: () => Promise<void>;
  createSpace: (input: { name: string; cadence: BudgetCadence }) => Promise<BudgetSpace>;
  deleteSpace: (spaceId: string) => Promise<void>;
}

export const useBudgetStore = create<BudgetStoreState>((set, get) => ({
  spaces: [],
  loadingSpaces: false,

  loadSpaces: async () => {
    set({ loadingSpaces: true });
    try {
      const data = await api<{ items: BudgetSpace[] }>('/budget/spaces');
      set({ spaces: data.items, loadingSpaces: false });
    } catch {
      set({ loadingSpaces: false });
    }
  },

  createSpace: async (input) => {
    const created = await api<BudgetSpace>('/budget/spaces', {
      method: 'POST',
      body: input,
    });
    await get().loadSpaces();
    return created;
  },

  deleteSpace: async (spaceId) => {
    await api(`/budget/spaces/${spaceId}`, { method: 'DELETE' });
    set((state) => ({ spaces: state.spaces.filter((s) => s.id !== spaceId) }));
  },
}));
