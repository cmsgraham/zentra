import { create } from 'zustand';
import { api } from './api-client';

const POPUP_W = 400;
const POPUP_H = 520;
const CHANNEL_NAME = 'zentra-focus-session';

let _channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (_channel) return _channel;
  try { _channel = new BroadcastChannel(CHANNEL_NAME); } catch { return null; }
  return _channel;
}
function broadcast(type: string, payload?: unknown) {
  try { getChannel()?.postMessage({ type, payload }); } catch { /* ignore */ }
}

function openWorkingPopup() {
  if (typeof window === 'undefined') return;
  const date = new Date().toLocaleDateString('en-CA');
  const left = window.screenX + Math.round((window.outerWidth - POPUP_W) / 2);
  const top = window.screenY + Math.round((window.outerHeight - POPUP_H) / 2);
  window.open(
    `/planner/working/mini?date=${date}`,
    'zentra-mini-working',
    `width=${POPUP_W},height=${POPUP_H},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
  );
}

export interface FocusSession {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  nextAction: string | null;
  plannedMinutes: number;
  startedAt: string; // ISO string
  brainDump: string;
}

interface FocusStore {
  session: FocusSession | null;
  /** Timestamp (ms) of the most recent session end. Drives the post-session "next up" prompt. */
  lastEndedAt: number | null;
  /** Show AI Plan modal alongside the overlay */
  aiPlanOpen: boolean;
  /** Dismiss the post-session prompt (clears lastEndedAt). */
  clearLastEnded: () => void;
  /** Start a focus session by taskId (used by direct Start button on known tasks) */
  startById: (taskId: string, taskTitle: string, nextAction: string | null, plannedMinutes?: number) => Promise<void>;
  /** Start a focus session by task title (used by AI Plan block Start buttons) */
  startByTitle: (taskTitle: string, plannedMinutes?: number) => Promise<void>;
  /** Mark current session complete */
  complete: () => Promise<void>;
  /** Abandon current session without marking the task done */
  abandon: () => Promise<void>;
  /** Extend by adding another block */
  extend: (additionalMinutes: 15 | 25) => Promise<void>;
  /** Update brain dump (debounce saving on the caller side) */
  setBrainDump: (text: string) => void;
  /** Persist brain dump to API */
  saveBrainDump: () => Promise<void>;
  /** Open/close the AI Plan view alongside focus */
  setAiPlanOpen: (open: boolean) => void;
  /** Restore any active session from the server (called on mount) */
  hydrate: () => Promise<void>;
  /** Subscribe to cross-window sync via BroadcastChannel. Returns unsubscribe fn. */
  subscribeSync: () => () => void;
  /** Open the working-mode popup window. */
  openPopup: () => void;
  /** Clear session locally & broadcast ENDED (for when API was called externally, e.g. by FocusSession). */
  markEnded: () => void;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  session: null,
  lastEndedAt: null,
  aiPlanOpen: false,

  clearLastEnded: () => set({ lastEndedAt: null }),

  startById: async (taskId, taskTitle, nextAction, plannedMinutes = 25) => {
    const res = await api<{ session: { id: string; startedAt: string } }>('/focus/sessions', {
      method: 'POST',
      body: { taskId, plannedMinutes },
    });
    set({
      lastEndedAt: null,
      session: {
        sessionId: res.session.id,
        taskId,
        taskTitle,
        nextAction,
        plannedMinutes,
        startedAt: res.session.startedAt,
        brainDump: '',
      },
    });
    broadcast('SESSION_STARTED', get().session);
    openWorkingPopup();
  },

  startByTitle: async (taskTitle, plannedMinutes = 25) => {
    // Resolve task ID from title first
    const found = await api<{ task: { id: string; title: string; status: string; nextAction: string | null } | null }>(
      `/tasks/by-title?title=${encodeURIComponent(taskTitle)}`,
    );
    if (!found.task) {
      // Title couldn't be resolved to a task (e.g. decorated/segment label or
      // archived). Signal caller with a distinct reason so the UI can tell the
      // user what actually happened instead of silently hiding the card.
      throw new Error(`TASK_NOT_FOUND: ${taskTitle}`);
    }
    if (found.task.status === 'done') {
      throw new Error(`TASK_ALREADY_DONE: ${taskTitle}`);
    }
    const { id, nextAction } = found.task;

    const res = await api<{ session: { id: string; startedAt: string } }>('/focus/sessions', {
      method: 'POST',
      body: { taskId: id, plannedMinutes },
    });
    set({
      lastEndedAt: null,
      session: {
        sessionId: res.session.id,
        taskId: id,
        taskTitle,
        nextAction,
        plannedMinutes,
        startedAt: res.session.startedAt,
        brainDump: '',
      },
    });
    broadcast('SESSION_STARTED', get().session);
    openWorkingPopup();
  },

  complete: async () => {
    const { session } = get();
    if (!session) return;
    await api(`/focus/sessions/${session.sessionId}/complete`, { method: 'PATCH' });
    await get().saveBrainDump();
    const endedAt = Date.now();
    set({ session: null, lastEndedAt: endedAt });
    broadcast('SESSION_ENDED', { lastEndedAt: endedAt });
  },

  abandon: async () => {
    const { session } = get();
    if (!session) return;
    await api(`/focus/sessions/${session.sessionId}/abandon`, { method: 'PATCH' });
    await get().saveBrainDump();
    const endedAt = Date.now();
    set({ session: null, lastEndedAt: endedAt });
    broadcast('SESSION_ENDED', { lastEndedAt: endedAt });
  },

  extend: async (additionalMinutes) => {
    const { session } = get();
    if (!session) return;
    const res = await api<{ session: { id: string; startedAt: string } }>(
      `/focus/sessions/${session.sessionId}/extend`,
      { method: 'PATCH', body: { additionalMinutes } },
    );
    set({
      session: {
        ...session,
        sessionId: res.session.id,
        plannedMinutes: additionalMinutes,
        startedAt: res.session.startedAt,
      },
    });
  },

  setBrainDump: (text) => {
    const { session } = get();
    if (!session) return;
    set({ session: { ...session, brainDump: text } });
  },

  saveBrainDump: async () => {
    const { session } = get();
    if (!session || !session.brainDump) return;
    try {
      await api(`/tasks/${session.taskId}/brain-dump`, {
        method: 'PATCH',
        body: { brainDump: session.brainDump },
      });
    } catch { /* non-critical */ }
  },

  setAiPlanOpen: (open) => set({ aiPlanOpen: open }),

  hydrate: async () => {
    try {
      const res = await api<{
        session: {
          id: string;
          taskId: string;
          startedAt: string;
          plannedMinutes: number;
          nextActionSnapshot: string | null;
          task: { title: string; nextAction: string | null };
        } | null;
      }>('/focus/sessions/active');
      if (res.session) {
        set({
          session: {
            sessionId: res.session.id,
            taskId: res.session.taskId,
            taskTitle: res.session.task.title,
            nextAction: res.session.task.nextAction ?? res.session.nextActionSnapshot,
            plannedMinutes: res.session.plannedMinutes,
            startedAt: res.session.startedAt,
            brainDump: '',
          },
        });
      }
    } catch { /* ignore — not authenticated yet */ }
  },

  subscribeSync: () => {
    const ch = getChannel();
    if (!ch) return () => {};
    const handler = (e: MessageEvent) => {
      const { type, payload } = e.data || {};
      if (type === 'SESSION_STARTED' && payload) {
        set({ session: payload, lastEndedAt: null });
      } else if (type === 'SESSION_ENDED') {
        set({ session: null, lastEndedAt: payload?.lastEndedAt ?? Date.now() });
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  },

  openPopup: () => {
    openWorkingPopup();
  },

  markEnded: () => {
    const endedAt = Date.now();
    set({ session: null, lastEndedAt: endedAt });
    broadcast('SESSION_ENDED', { lastEndedAt: endedAt });
  },
}));
