'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useFocusStore } from '@/lib/useFocusStore';
import { useRouter } from 'next/navigation';
import { EmptyPriorityPrompt } from './EmptyPriorityPrompt';
import { StartButton } from './StartButton';
import { NextActionInput } from './NextActionInput';
import { FocusSession } from './FocusSession';
import { CompleteDayView } from './CompleteDayView';
import { SoftUrgencyBadge } from './SoftUrgencyBadge';

type TodayState = 'loading' | 'empty' | 'primed' | 'focused' | 'complete' | 'error';

interface PriorityTask {
  id: string;
  title: string;
  nextAction: string | null;
  nextActionState: 'unclear' | 'set' | 'done';
}

interface ActiveSession {
  id: string;
  taskId: string;
  plannedMinutes: number;
  startedAt: string;
  nextActionSnapshot: string | null;
}

interface TodayStats {
  completedCount: number;
  totalMinutes: number;
}

export function TodayView() {
  const { user } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<TodayState>('loading');
  const [priority, setPriority] = useState<PriorityTask | null>(null);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [stats, setStats] = useState<TodayStats>({ completedCount: 0, totalMinutes: 0 });
  const [defaultSession, setDefaultSession] = useState(25);
  const [endOfDay, setEndOfDay] = useState('18:00');
  const [startLoading, setStartLoading] = useState(false);

  async function loadState() {
    try {
      // Fetch priority + session authoritatively (no silent fallback). Stats are non-critical.
      const [priorityRes, sessionRes, statsRes] = await Promise.all([
        api<{ task: PriorityTask | null }>('/priority/today'),
        api<{ session: ActiveSession | null }>('/focus/sessions/active'),
        api<{ completedCount: number; totalMinutes: number }>('/focus/sessions/today').catch(() => ({ completedCount: 0, totalMinutes: 0 })),
      ]);

      const priorityTask = priorityRes.task;
      const activeSession = sessionRes.session;

      setPriority(priorityTask);
      setSession(activeSession);
      setStats({ completedCount: statsRes.completedCount, totalMinutes: statsRes.totalMinutes });

      if (activeSession) {
        setState('focused');
      } else if (!priorityTask) {
        // If the user has completed sessions today but no current priority, show Complete.
        setState(statsRes.completedCount > 0 ? 'complete' : 'empty');
      } else if (priorityTask.nextActionState === 'done') {
        setState('complete');
      } else {
        setState('primed');
      }
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    loadState();
    // Fetch user prefs for end-of-day time
    api<{ zentraEndOfDayTime?: string; zentraDefaultSessionMinutes?: number }>('/auth/me')
      .then((res) => {
        if (res?.zentraEndOfDayTime) setEndOfDay(res.zentraEndOfDayTime);
        if (res?.zentraDefaultSessionMinutes) setDefaultSession(res.zentraDefaultSessionMinutes);
      })
      .catch(() => {});
  }, []);

  const startById = useFocusStore((s) => s.startById);
  const syncFocusStore = useFocusStore((s) => s.hydrate);
  const lastEndedAt = useFocusStore((s) => s.lastEndedAt);

  // When the popup's Done button fires markEnded(), lastEndedAt changes.
  // If TodayView is still in 'focused' state, sync it to 'complete'.
  useEffect(() => {
    if (state === 'focused' && lastEndedAt !== null) {
      setPriority((p) => p ? { ...p, nextActionState: 'done' } : p);
      setState('complete');
      loadState();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEndedAt]);

  async function handleStartSession() {
    if (!priority) return;
    setStartLoading(true);
    try {
      // Use the global store — this starts the session AND activates the floating overlay
      await startById(priority.id, priority.title, priority.nextAction, defaultSession);
      // Also fetch session data for TodayView's own FocusSession component
      const sessionRes = await api<{ session: ActiveSession | null }>('/focus/sessions/active').catch(() => ({ session: null }));
      if (sessionRes.session) {
        setSession(sessionRes.session);
        setState('focused');
      }
    } catch (err: any) {
      // If session already active, reload
      await loadState();
      await syncFocusStore();
    } finally {
      setStartLoading(false);
    }
  }

  async function handleNextActionSave(nextAction: string) {
    if (!priority) return;
    try {
      const res = await api<PriorityTask>(`/tasks/${priority.id}/next-action`, {
        method: 'PATCH',
        body: JSON.stringify({ nextAction }),
      });
      setPriority((p) => p ? { ...p, nextAction, nextActionState: 'set' } : p);
    } catch {
      // ignore
    }
  }

  if (state === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <span style={{ color: 'var(--ink-text-muted)', fontSize: '0.9375rem' }}>Loading...</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          padding: '60px 24px',
          textAlign: 'center',
          maxWidth: '400px',
          margin: '0 auto',
        }}
      >
        <p style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0 }}>
          Something's off on our end.
        </p>
        <p style={{ fontSize: '0.9375rem', color: 'var(--ink-text-muted)', margin: 0 }}>
          We couldn't load today. Try again in a moment.
        </p>
        <div style={{ display: 'flex', gap: '10px', width: '100%', marginTop: '8px' }}>
          <button
            onClick={() => { setState('loading'); loadState(); }}
            style={{
              flex: 1,
              padding: '14px',
              background: 'var(--ink-text)',
              color: 'var(--ink-bg)',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <button
            onClick={() => router.push('/planner')}
            style={{
              flex: 1,
              padding: '14px',
              background: 'var(--ink-surface)',
              border: '1px solid var(--ink-border)',
              borderRadius: '10px',
              color: 'var(--ink-text)',
              cursor: 'pointer',
            }}
          >
            Back to planner
          </button>
        </div>
      </div>
    );
  }

  if (state === 'empty') {
    return <EmptyPriorityPrompt onPrioritySet={(task) => { setPriority(task); setState('primed'); }} />;
  }

  if (state === 'focused' && session && priority) {
    return (
      <FocusSession
        sessionId={session.id}
        taskId={priority.id}
        taskTitle={priority.title}
        nextAction={session.nextActionSnapshot ?? priority.nextAction}
        plannedMinutes={session.plannedMinutes}
        startedAt={session.startedAt}
        onComplete={() => {
          useFocusStore.getState().markEnded(); // clear overlay + stop counter immediately
          setPriority((p) => p ? { ...p, nextActionState: 'done' } : p);
          setState('complete');
          loadState();
        }}
        onAbandon={() => {
          useFocusStore.getState().hydrate(); // clear overlay
          setSession(null);
          // Re-evaluate after move-on: if there's no next priority, show Complete
          // (handled inside loadState via statsRes.completedCount check).
          loadState();
        }}
      />
    );
  }

  if (state === 'complete') {
    return (
      <CompleteDayView
        completedCount={stats.completedCount}
        totalMinutes={stats.totalMinutes}
        onAddAnother={() => {
          setPriority(null);
          setState('empty');
        }}
        onStartSuggested={(task) => {
          setPriority({
            id: task.id,
            title: task.title,
            nextAction: task.nextAction ?? null,
            nextActionState: task.nextActionState ?? 'unclear',
          });
          setState('primed');
        }}
      />
    );
  }

  // Primed state
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '40px 24px',
        maxWidth: '400px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0 }}>
          Flow
        </h1>
        <SoftUrgencyBadge endOfDayTime={endOfDay} />
      </div>

      {/* Task title */}
      <div>
        <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink-text)', margin: '0 0 6px' }}>
          {priority?.title}
        </p>
        {priority?.nextAction && priority.nextActionState !== 'unclear' && (
          <p style={{ fontSize: '0.9375rem', color: 'var(--ink-text-muted)', margin: 0 }}>
            {priority.nextAction}
          </p>
        )}
      </div>

      {/* If next action is unclear, show the input — but also allow starting right away */}
      {(!priority?.nextAction || priority.nextActionState === 'unclear') && priority ? (
        <>
          <NextActionInput
            taskId={priority.id}
            value={priority.nextAction}
            onSave={handleNextActionSave}
          />
          <StartButton
            onClick={handleStartSession}
            loading={startLoading}
            plannedMinutes={defaultSession}
          />
        </>
      ) : (
        <StartButton
          onClick={handleStartSession}
          loading={startLoading}
          plannedMinutes={defaultSession}
        />
      )}

      {/* Change priority */}
      <button
        onClick={() => { setPriority(null); setState('empty'); }}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-text-muted)',
          fontSize: '0.875rem',
          cursor: 'pointer',
          padding: 0,
          alignSelf: 'center',
        }}
      >
        Change priority
      </button>
    </div>
  );
}
