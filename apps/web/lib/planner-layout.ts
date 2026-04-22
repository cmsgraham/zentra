import { create } from 'zustand';
import { api } from '@/lib/api-client';

/* ── Widget definitions ── */

export type WidgetId =
  | 'calendar-mood'
  | 'schedule'
  | 'goals'
  | 'pomodoro'
  | 'due-tasks'
  | 'notes'
  | 'reflection'
  | 'tomorrow'
  | 'today-plan';

export interface WidgetDef {
  id: WidgetId;
  label: string;
  icon: string;
}

export const ALL_WIDGETS: WidgetDef[] = [
  { id: 'calendar-mood', label: 'Calendar & Mood', icon: 'C' },
  { id: 'schedule',      label: 'Schedule',        icon: 'S' },
  { id: 'goals',         label: 'Intentions for today', icon: 'G' },
  { id: 'pomodoro',      label: 'Focus Timer',     icon: 'F' },
  { id: 'due-tasks',     label: 'Due soon',        icon: 'D' },
  { id: 'notes',         label: 'Notes',           icon: 'N' },
  { id: 'reflection',    label: 'Reflection',      icon: 'R' },
  { id: 'tomorrow',      label: 'Tomorrow',        icon: 'T' },
  { id: 'today-plan',    label: "Today's flow",    icon: 'P' },
];

/* ── Zone layout model ── */

export interface Zone {
  id: string;
  height: number; // 0–1 flex ratio within column
  widget: WidgetId | null;
}

export interface Column {
  id: string;
  width: number; // 0–1 fraction of total width
  zones: Zone[];
}

export type LayoutType =
  | 'default'
  | 'columns'
  | 'rows'
  | 'grid'
  | 'priority'
  | 'focus'
  | 'custom';

export interface ZoneLayout {
  type: LayoutType;
  columns: Column[];
}

/* ── ID generation ── */

let _ctr = 0;
export function zid() {
  return (Date.now() + ++_ctr).toString(36);
}

/* ── Layout templates ── */

export interface LayoutTemplate {
  label: string;
  desc: string;
  create: () => ZoneLayout;
}

export const TEMPLATE_ORDER: LayoutType[] = [
  'default',
  'columns',
  'rows',
  'grid',
  'priority',
  'focus',
  'custom',
];

export const LAYOUT_TEMPLATES: Record<LayoutType, LayoutTemplate> = {
  default: {
    label: 'Default',
    desc: 'Classic 4-column planner',
    create: () => ({
      type: 'default',
      columns: [
        {
          id: zid(),
          width: 0.22,
          zones: [
            { id: zid(), height: 0.55, widget: 'calendar-mood' },
            { id: zid(), height: 0.45, widget: 'pomodoro' },
          ],
        },
        {
          id: zid(),
          width: 0.28,
          zones: [{ id: zid(), height: 1, widget: 'schedule' }],
        },
        {
          id: zid(),
          width: 0.25,
          zones: [
            { id: zid(), height: 0.5, widget: 'goals' },
            { id: zid(), height: 0.5, widget: 'due-tasks' },
          ],
        },
        {
          id: zid(),
          width: 0.25,
          zones: [
            { id: zid(), height: 0.35, widget: 'notes' },
            { id: zid(), height: 0.35, widget: 'reflection' },
            { id: zid(), height: 0.3, widget: 'tomorrow' },
          ],
        },
      ],
    }),
  },

  columns: {
    label: 'Columns',
    desc: '3 equal columns',
    create: () => ({
      type: 'columns',
      columns: [
        {
          id: zid(),
          width: 0.333,
          zones: [
            { id: zid(), height: 0.5, widget: 'calendar-mood' },
            { id: zid(), height: 0.5, widget: 'pomodoro' },
          ],
        },
        {
          id: zid(),
          width: 0.334,
          zones: [
            { id: zid(), height: 0.5, widget: 'schedule' },
            { id: zid(), height: 0.5, widget: 'goals' },
          ],
        },
        {
          id: zid(),
          width: 0.333,
          zones: [
            { id: zid(), height: 0.5, widget: 'notes' },
            { id: zid(), height: 0.5, widget: 'reflection' },
          ],
        },
      ],
    }),
  },

  rows: {
    label: 'Rows',
    desc: 'Stacked full-width rows',
    create: () => ({
      type: 'rows',
      columns: [
        {
          id: zid(),
          width: 1,
          zones: [
            { id: zid(), height: 0.25, widget: 'schedule' },
            { id: zid(), height: 0.2, widget: 'goals' },
            { id: zid(), height: 0.25, widget: 'notes' },
            { id: zid(), height: 0.15, widget: 'pomodoro' },
            { id: zid(), height: 0.15, widget: 'reflection' },
          ],
        },
      ],
    }),
  },

  grid: {
    label: 'Grid',
    desc: '2×3 balanced grid',
    create: () => ({
      type: 'grid',
      columns: [
        {
          id: zid(),
          width: 0.5,
          zones: [
            { id: zid(), height: 0.33, widget: 'calendar-mood' },
            { id: zid(), height: 0.34, widget: 'schedule' },
            { id: zid(), height: 0.33, widget: 'notes' },
          ],
        },
        {
          id: zid(),
          width: 0.5,
          zones: [
            { id: zid(), height: 0.33, widget: 'goals' },
            { id: zid(), height: 0.34, widget: 'due-tasks' },
            { id: zid(), height: 0.33, widget: 'reflection' },
          ],
        },
      ],
    }),
  },

  priority: {
    label: 'Priority',
    desc: 'Large main area + sidebar',
    create: () => ({
      type: 'priority',
      columns: [
        {
          id: zid(),
          width: 0.6,
          zones: [
            { id: zid(), height: 0.55, widget: 'schedule' },
            { id: zid(), height: 0.45, widget: 'notes' },
          ],
        },
        {
          id: zid(),
          width: 0.4,
          zones: [
            { id: zid(), height: 0.3, widget: 'calendar-mood' },
            { id: zid(), height: 0.25, widget: 'goals' },
            { id: zid(), height: 0.25, widget: 'pomodoro' },
            { id: zid(), height: 0.2, widget: 'due-tasks' },
          ],
        },
      ],
    }),
  },

  focus: {
    label: 'Focus',
    desc: 'Distraction-free with timer',
    create: () => ({
      type: 'focus',
      columns: [
        {
          id: zid(),
          width: 0.55,
          zones: [
            { id: zid(), height: 0.7, widget: 'notes' },
            { id: zid(), height: 0.3, widget: 'reflection' },
          ],
        },
        {
          id: zid(),
          width: 0.45,
          zones: [
            { id: zid(), height: 0.35, widget: 'pomodoro' },
            { id: zid(), height: 0.35, widget: 'goals' },
            { id: zid(), height: 0.3, widget: 'tomorrow' },
          ],
        },
      ],
    }),
  },

  custom: {
    label: 'Custom',
    desc: 'Start from scratch',
    create: () => ({
      type: 'custom',
      columns: [
        {
          id: zid(),
          width: 0.5,
          zones: [{ id: zid(), height: 1, widget: null }],
        },
        {
          id: zid(),
          width: 0.5,
          zones: [{ id: zid(), height: 1, widget: null }],
        },
      ],
    }),
  },
};

/* ── Zustand store ── */

interface LayoutState {
  layout: ZoneLayout;
  editingLayout: boolean;
  loaded: boolean;

  init: () => void;
  setLayout: (layout: ZoneLayout) => void;
  applyTemplate: (type: LayoutType) => void;
  setEditingLayout: (v: boolean) => void;
  resetLayout: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistLayout(layout: ZoneLayout) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api('/planner/layout', { method: 'PUT', body: layout });
    } catch {
      /* silent */
    }
  }, 600);
}

export const usePlannerLayout = create<LayoutState>((set, get) => ({
  layout: LAYOUT_TEMPLATES.default.create(),
  editingLayout: false,
  loaded: false,

  async init() {
    try {
      const res = await api<{ layout: ZoneLayout | null }>('/planner/layout');
      if (res.layout?.columns?.length) {
        set({ layout: res.layout, loaded: true });
        return;
      }
    } catch {
      /* use default */
    }
    set({ layout: LAYOUT_TEMPLATES.default.create(), loaded: true });
  },

  setLayout(layout) {
    set({ layout });
    persistLayout(layout);
  },

  applyTemplate(type) {
    const layout = LAYOUT_TEMPLATES[type].create();
    set({ layout });
    persistLayout(layout);
  },

  setEditingLayout(v) {
    set({ editingLayout: v });
  },

  async resetLayout() {
    const layout = LAYOUT_TEMPLATES.default.create();
    set({ layout, editingLayout: false });
    try {
      await api('/planner/layout', { method: 'DELETE' });
    } catch {
      /* silent */
    }
  },
}));
