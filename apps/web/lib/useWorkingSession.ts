'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';

// ═══ Types ═══

export interface PlanBlock {
  start: string;
  end: string;
  type: 'focus' | 'quick' | 'call' | 'break' | string;
  tasks: string[];
}

export interface GoalData {
  id: string;
  title: string;
  status: 'pending' | 'done' | 'skipped';
  linkedTaskId: string | null;
  linkedTask?: { id: string; status: string } | null;
}

export interface WorkingSessionState {
  date: string;
  blocks: PlanBlock[];
  goals: GoalData[];
  completedTasks: Set<string>;
  currentMinute: number;
  loaded: boolean;
  isPaused: boolean;
}

export interface WorkingSessionActions {
  toggleTask: (taskTitle: string) => Promise<void>;
  completeCurrentBlock: () => void;
  startNextBlock: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  refreshData: () => Promise<void>;
  endDay: () => Promise<{ completedCount: number; movedBackCount: number }>;
}

export interface WorkingSessionDerived {
  activeBlock: PlanBlock | null;
  activeBlockIndex: number;
  nextWorkBlock: PlanBlock | null;
  minutesLeft: number;
  workBlocks: PlanBlock[];
  completedBlockCount: number;
  isBlockComplete: boolean;
  progressPercent: number;
  allTasks: string[];
}

const BROADCAST_CHANNEL_NAME = 'inkflow-working-session';

// ═══ Utilities ═══

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function nowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatDate(d: string): string {
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ═══ Hook ═══

export function useWorkingSession(date: string, enabled: boolean = true) {
  const [blocks, setBlocks] = useState<PlanBlock[]>([]);
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  const [currentMinute, setCurrentMinute] = useState(nowMinutes());
  const [loaded, setLoaded] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [animatingTask, setAnimatingTask] = useState<string | null>(null);

  // BroadcastChannel for cross-window sync
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Initialize BroadcastChannel
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      channelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channelRef.current.onmessage = (event) => {
        const { type, payload } = event.data;
        switch (type) {
          case 'TASK_TOGGLED':
            setCompletedTasks(new Set(payload.completedTasks));
            break;
          case 'DATA_REFRESHED':
            setBlocks(payload.blocks);
            setGoals(payload.goals);
            setCompletedTasks(new Set(payload.completedTasks));
            break;
          case 'SESSION_PAUSED':
            setIsPaused(true);
            break;
          case 'SESSION_RESUMED':
            setIsPaused(false);
            break;
        }
      };
    } catch {
      // BroadcastChannel not supported
      console.warn('BroadcastChannel not supported');
    }

    return () => {
      channelRef.current?.close();
    };
  }, []);

  // Broadcast helper
  const broadcast = useCallback((type: string, payload: Record<string, unknown>) => {
    try {
      channelRef.current?.postMessage({ type, payload });
    } catch {
      // Ignore broadcast errors
    }
  }, []);

  // Load data from API
  const loadData = useCallback(async () => {
    if (!enabled) return;
    
    const data = await api<{
      plan: { planBlocks: PlanBlock[] | null } | null;
      goals: GoalData[];
    }>(`/planner?date=${date}`);

    const newBlocks = data.plan?.planBlocks ?? [];
    const newGoals = data.goals;

    // Mark already-done goals as completed.
    // Also check linkedTask.status in case the task was completed via a focus
    // session (which updates tasks.status but not daily_plan_goals.status).
    const done = new Set<string>();
    for (const g of newGoals) {
      if (g.status === 'done' || g.linkedTask?.status === 'done') {
        const cleanTitle = g.title.replace(/^\[\d{2}:\d{2}\]\s*/, '');
        done.add(cleanTitle);
      }
    }

    setBlocks(newBlocks);
    setGoals(newGoals);
    setCompletedTasks(done);
    setLoaded(true);

    // Broadcast the refresh to other windows
    broadcast('DATA_REFRESHED', {
      blocks: newBlocks,
      goals: newGoals,
      completedTasks: Array.from(done),
    });
  }, [date, enabled, broadcast]);

  // Initial load
  useEffect(() => {
    if (enabled) loadData();
  }, [enabled, loadData]);

  // Refresh when window regains focus or becomes visible — fixes stale
  // "done" state when a task is completed in another window/tab.
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => { loadData(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') loadData(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, loadData]);

  // Poll every 30s to pick up done-state changes made elsewhere (focus
  // sessions in another window, board drag-and-drop, etc.).
  useEffect(() => {
    if (!enabled || isPaused) return;
    const id = setInterval(() => { loadData(); }, 30_000);
    return () => clearInterval(id);
  }, [enabled, isPaused, loadData]);

  // Update clock every 30s (unless paused)
  useEffect(() => {
    if (!enabled || isPaused) return;
    const id = setInterval(() => setCurrentMinute(nowMinutes()), 30_000);
    return () => clearInterval(id);
  }, [enabled, isPaused]);

  // ═══ Derived state ═══

  const workBlocks = blocks.filter(b => b.type !== 'break');

  const activeBlockIndex = blocks.findIndex(b => {
    const s = timeToMinutes(b.start);
    const e = timeToMinutes(b.end);
    return currentMinute >= s && currentMinute < e;
  });

  const activeBlock = activeBlockIndex >= 0 ? blocks[activeBlockIndex] : null;

  const nextWorkBlock = blocks.find(b => {
    return b.type !== 'break' && timeToMinutes(b.start) > currentMinute;
  }) ?? null;

  const minutesLeft = activeBlock ? timeToMinutes(activeBlock.end) - currentMinute : 0;

  const isBlockComplete = activeBlock 
    ? activeBlock.tasks.every(t => completedTasks.has(t))
    : false;

  const completedBlockCount = workBlocks.filter(b => {
    const allDone = b.tasks.every(t => completedTasks.has(t));
    const isPast = currentMinute >= timeToMinutes(b.end);
    return allDone || isPast;
  }).length;

  const progressPercent = blocks.length > 0
    ? Math.min(100, Math.max(0,
        ((currentMinute - timeToMinutes(blocks[0].start)) /
          (timeToMinutes(blocks[blocks.length - 1].end) - timeToMinutes(blocks[0].start))) * 100
      ))
    : 0;

  const allTasks = [...new Set(blocks.flatMap(b => b.type !== 'break' ? b.tasks : []))];

  // ═══ Actions ═══

  const toggleTask = useCallback(async (taskTitle: string) => {
    const isCompleted = completedTasks.has(taskTitle);
    setAnimatingTask(taskTitle);

    // Optimistic update
    const newCompletedTasks = new Set(completedTasks);
    if (isCompleted) {
      newCompletedTasks.delete(taskTitle);
    } else {
      newCompletedTasks.add(taskTitle);
    }
    setCompletedTasks(newCompletedTasks);

    // Broadcast the change immediately
    broadcast('TASK_TOGGLED', {
      completedTasks: Array.from(newCompletedTasks),
      taskTitle,
      isCompleted: !isCompleted,
    });

    // Find the matching goal and toggle it
    const matchingGoal = goals.find(g => {
      const cleanTitle = g.title.replace(/^\[\d{2}:\d{2}\]\s*/, '');
      return cleanTitle === taskTitle;
    });

    if (matchingGoal) {
      const newStatus = isCompleted ? 'pending' : 'done';
      try {
        await api(`/planner/goals/${matchingGoal.id}`, {
          method: 'PATCH',
          body: { status: newStatus },
        });

        // Also update linked task status
        if (matchingGoal.linkedTaskId) {
          try {
            await api(`/tasks/${matchingGoal.linkedTaskId}/move`, {
              method: 'POST',
              body: { status: isCompleted ? 'pending' : 'done' },
            });
          } catch {
            // Non-critical
          }
        }
      } catch {
        // Revert on error
        const revertedTasks = new Set(completedTasks);
        setCompletedTasks(revertedTasks);
        broadcast('TASK_TOGGLED', {
          completedTasks: Array.from(revertedTasks),
        });
      }
    }

    setTimeout(() => setAnimatingTask(null), 300);
  }, [completedTasks, goals, broadcast]);

  const completeCurrentBlock = useCallback(() => {
    if (!activeBlock) return;
    
    // Mark all tasks in current block as done
    const newCompletedTasks = new Set(completedTasks);
    activeBlock.tasks.forEach(task => newCompletedTasks.add(task));
    setCompletedTasks(newCompletedTasks);

    broadcast('TASK_TOGGLED', {
      completedTasks: Array.from(newCompletedTasks),
    });

    // Persist to backend
    activeBlock.tasks.forEach(async (taskTitle) => {
      const matchingGoal = goals.find(g => {
        const cleanTitle = g.title.replace(/^\[\d{2}:\d{2}\]\s*/, '');
        return cleanTitle === taskTitle;
      });

      if (matchingGoal && matchingGoal.status !== 'done') {
        try {
          await api(`/planner/goals/${matchingGoal.id}`, {
            method: 'PATCH',
            body: { status: 'done' },
          });
          if (matchingGoal.linkedTaskId) {
            await api(`/tasks/${matchingGoal.linkedTaskId}/move`, {
              method: 'POST',
              body: { status: 'done' },
            }).catch(() => {});
          }
        } catch {
          // Ignore errors for batch completion
        }
      }
    });
  }, [activeBlock, completedTasks, goals, broadcast]);

  const startNextBlock = useCallback(() => {
    // This conceptually moves to the next block
    // In practice, time-based blocks auto-advance
    // We can skip to the next block's start time conceptually
    if (nextWorkBlock) {
      setCurrentMinute(timeToMinutes(nextWorkBlock.start));
    }
  }, [nextWorkBlock]);

  const pauseSession = useCallback(() => {
    setIsPaused(true);
    broadcast('SESSION_PAUSED', {});
  }, [broadcast]);

  const resumeSession = useCallback(() => {
    setIsPaused(false);
    setCurrentMinute(nowMinutes());
    broadcast('SESSION_RESUMED', {});
  }, [broadcast]);

  const refreshData = useCallback(async () => {
    await loadData();
  }, [loadData]);

  const endDay = useCallback(async () => {
    // Find all goals whose tasks were NOT completed
    const uncompletedGoals = goals.filter(g => {
      const cleanTitle = g.title.replace(/^\[\d{2}:\d{2}\]\s*/, '');
      return !completedTasks.has(cleanTitle) && g.linkedTaskId;
    });

    // Move their linked tasks back to pending (backlog)
    await Promise.allSettled(
      uncompletedGoals.map(g =>
        api(`/tasks/${g.linkedTaskId}/move`, {
          method: 'POST',
          body: { status: 'pending' },
        })
      )
    );

    return {
      completedCount: completedTasks.size,
      movedBackCount: uncompletedGoals.length,
    };
  }, [goals, completedTasks]);

  return {
    // State
    state: {
      date,
      blocks,
      goals,
      completedTasks,
      currentMinute,
      loaded,
      isPaused,
    } as WorkingSessionState,

    // Derived
    derived: {
      activeBlock,
      activeBlockIndex,
      nextWorkBlock,
      minutesLeft,
      workBlocks,
      completedBlockCount,
      isBlockComplete,
      progressPercent,
      allTasks,
    } as WorkingSessionDerived,

    // Actions
    actions: {
      toggleTask,
      completeCurrentBlock,
      startNextBlock,
      pauseSession,
      resumeSession,
      refreshData,
      endDay,
    } as WorkingSessionActions,

    // Animation state
    animatingTask,
  };
}
