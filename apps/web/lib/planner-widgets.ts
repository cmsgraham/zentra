import { create } from 'zustand';
import { api } from '@/lib/api-client';

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

/** col / row span presets for the 4-column desktop grid */
export type WidgetSize = 'compact' | 'standard' | 'wide' | 'tall' | 'large';

export interface WidgetDef {
  id: WidgetId;
  label: string;
  defaultSize: WidgetSize;
  /** Which size presets this widget supports */
  allowedSizes: WidgetSize[];
}

/**
 * Grid spans per size preset.
 * The grid uses 4 columns on xl, 3 on lg, 2 on md, 1 on sm.
 * Row unit = 80px via grid-auto-rows.
 */
export const WIDGET_SPANS: Record<WidgetSize, { col: number; row: number }> = {
  compact:  { col: 1, row: 3 },
  standard: { col: 1, row: 4 },
  wide:     { col: 2, row: 3 },
  tall:     { col: 1, row: 5 },
  large:    { col: 2, row: 4 },
};

export const SIZE_LABELS: Record<WidgetSize, string> = {
  compact:  'Small',
  standard: 'Medium',
  wide:     'Wide',
  tall:     'Tall',
  large:    'Large',
};

export const ALL_WIDGETS: WidgetDef[] = [
  { id: 'calendar-mood', label: 'Calendar & Mood',  defaultSize: 'standard', allowedSizes: ['compact', 'standard'] },
  { id: 'schedule',      label: 'Schedule',          defaultSize: 'tall',     allowedSizes: ['standard', 'tall', 'wide'] },
  { id: 'goals',         label: 'Intentions for today', defaultSize: 'standard', allowedSizes: ['standard', 'tall'] },
  { id: 'pomodoro',      label: 'Focus Timer',       defaultSize: 'compact',  allowedSizes: ['compact', 'standard', 'wide'] },
  { id: 'due-tasks',     label: 'Due soon',          defaultSize: 'tall',     allowedSizes: ['standard', 'tall'] },
  { id: 'notes',         label: 'Notes',             defaultSize: 'wide',     allowedSizes: ['standard', 'wide', 'tall', 'large'] },
  { id: 'reflection',    label: 'Reflection',        defaultSize: 'standard', allowedSizes: ['standard', 'wide'] },
  { id: 'tomorrow',      label: 'Tomorrow',          defaultSize: 'standard', allowedSizes: ['standard', 'wide'] },
  { id: 'today-plan',    label: "Today's flow",      defaultSize: 'tall',     allowedSizes: ['standard', 'tall', 'wide'] },
];

interface LayoutData {
  order: WidgetId[];
  hidden: WidgetId[];
  sizes?: Partial<Record<WidgetId, WidgetSize>>;
}

interface WidgetLayoutState {
  order: WidgetId[];
  hidden: Set<WidgetId>;
  sizes: Map<WidgetId, WidgetSize>;
  editing: boolean;
  loaded: boolean;
  init: () => void;
  reorder: (newOrder: WidgetId[]) => void;
  hide: (id: WidgetId) => void;
  show: (id: WidgetId) => void;
  resize: (id: WidgetId, size: WidgetSize) => void;
  setEditing: (v: boolean) => void;
  resetLayout: () => void;
  getSize: (id: WidgetId) => WidgetSize;
}

const defaultOrder: WidgetId[] = ALL_WIDGETS.map((w) => w.id);

function getDefaults() {
  return {
    order: [...defaultOrder],
    hidden: new Set<WidgetId>(),
    sizes: new Map<WidgetId, WidgetSize>(),
  };
}

/** Debounced API persist */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistToApi(state: { order: WidgetId[]; hidden: Set<WidgetId>; sizes: Map<WidgetId, WidgetSize> }) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const body: LayoutData = {
        order: state.order,
        hidden: [...state.hidden],
        sizes: Object.fromEntries(state.sizes) as Partial<Record<WidgetId, WidgetSize>>,
      };
      await api('/planner/layout', { method: 'PUT', body });
    } catch {}
  }, 600);
}

export const useWidgetLayout = create<WidgetLayoutState>((set, get) => ({
  ...getDefaults(),
  editing: false,
  loaded: false,

  async init() {
    try {
      const res = await api<{ layout: LayoutData | null }>('/planner/layout');
      if (res.layout) {
        const { order, hidden, sizes } = res.layout;
        const known = new Set(order);
        const full = [...order, ...defaultOrder.filter((id) => !known.has(id))];
        const sizeMap = new Map<WidgetId, WidgetSize>();
        if (sizes) {
          for (const [k, v] of Object.entries(sizes)) {
            sizeMap.set(k as WidgetId, v as WidgetSize);
          }
        }
        set({ order: full, hidden: new Set(hidden), sizes: sizeMap, loaded: true });
        return;
      }
    } catch {}
    set({ ...getDefaults(), loaded: true });
  },

  reorder(newOrder) {
    set({ order: newOrder });
    persistToApi(get());
  },

  hide(id) {
    const { hidden } = get();
    const next = new Set(hidden);
    next.add(id);
    set({ hidden: next });
    persistToApi(get());
  },

  show(id) {
    const { order, hidden } = get();
    const next = new Set(hidden);
    next.delete(id);
    const newOrder = order.includes(id) ? order : [...order, id];
    set({ hidden: next, order: newOrder });
    persistToApi(get());
  },

  resize(id, size) {
    const { sizes } = get();
    const next = new Map(sizes);
    const def = ALL_WIDGETS.find((w) => w.id === id);
    if (def && size === def.defaultSize) {
      next.delete(id); // no need to store the default
    } else {
      next.set(id, size);
    }
    set({ sizes: next });
    persistToApi(get());
  },

  setEditing(v) {
    set({ editing: v });
  },

  async resetLayout() {
    set({ ...getDefaults(), editing: false });
    try {
      await api('/planner/layout', { method: 'DELETE' });
    } catch {}
  },

  getSize(id) {
    const { sizes } = get();
    if (sizes.has(id)) return sizes.get(id)!;
    const def = ALL_WIDGETS.find((w) => w.id === id);
    return def?.defaultSize ?? 'standard';
  },
}));
