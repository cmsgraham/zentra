'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useFocusStore } from '@/lib/useFocusStore';
import MiniWorkingMode from '@/components/planner/MiniWorkingMode';
import { CompactFocusSession } from '@/components/zentra/CompactFocusSession';
import { CompactNextUp } from '@/components/zentra/CompactNextUp';

/**
 * Mini Working Mode Page — popup window for detached execution.
 *
 * - Renders FocusSession when a focus session is active (cross-window synced)
 * - Falls back to the day-plan view (MiniWorkingMode) when no session
 * - "See my plan" focuses opener and navigates it to /planner
 */
function MiniWorkingModeContent() {
  const { user, loading, loadUser } = useAuth();
  const { init: initTheme } = useTheme();
  const searchParams = useSearchParams();
  const today = searchParams.get('date') || new Date().toLocaleDateString('en-CA');

  const session = useFocusStore((s) => s.session);
  const lastEndedAt = useFocusStore((s) => s.lastEndedAt);
  const clearLastEnded = useFocusStore((s) => s.clearLastEnded);
  const hydrate = useFocusStore((s) => s.hydrate);
  const subscribeSync = useFocusStore((s) => s.subscribeSync);
  const markEnded = useFocusStore((s) => s.markEnded);

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { initTheme(); }, [initTheme]);
  useEffect(() => { if (user) hydrate(); }, [user, hydrate]);
  useEffect(() => subscribeSync(), [subscribeSync]);

  const handleOpenFullMode = () => {
    // Opening a new tab reliably restores Chrome from minimized state
    // (window.opener.focus() is blocked by Chrome when the opener is minimized).
    // Keeps the main Chrome window at its current size — just un-minimizes it.
    window.open('/planner', '_blank');
    window.close();
  };

  // "See my plan" — focus opener, navigate to planner, and park the popup
  // in the top-right of the screen so it doesn't cover the plan.
  const handleSeePlan = () => {
    navigateOpenerTo('/planner');
  };

  const handleReflect = () => {
    navigateOpenerTo('/reflect', true);
  };

  // "Not now" / dismiss — take the user to the Canvas (daily planner).
  const handleDismiss = () => {
    clearLastEnded();
    navigateOpenerTo('/planner', true);
  };

  const navigateOpenerTo = (path: string, closeSelf = false) => {
    if (window.opener && !window.opener.closed) {
      try {
        if (window.opener.location.pathname !== path) {
          window.opener.location.href = path;
        }
      } catch { /* cross-origin safety — shouldn't happen */ }
      window.opener.focus();
      if (closeSelf) { window.close(); return; }
    } else {
      window.open(path, '_blank');
      if (closeSelf) { window.close(); return; }
    }
    // Otherwise, move popup to top-right corner so it doesn't cover the plan.
    try {
      const margin = 16;
      const w = window.outerWidth || 400;
      const availW = (window.screen as Screen & { availLeft?: number }).availWidth ?? window.screen.width;
      const availLeft = (window.screen as Screen & { availLeft?: number }).availLeft ?? 0;
      const availTop = (window.screen as Screen & { availTop?: number }).availTop ?? 0;
      const x = availLeft + availW - w - margin;
      const y = availTop + margin;
      window.moveTo(x, y);
    } catch { /* moveTo may be blocked in some browsers */ }
  };

  if (loading) {
    return (
      <div className="mini-wm-container mini-wm-standalone">
        <div className="mini-wm-loading">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mini-wm-container mini-wm-standalone">
        <div className="mini-wm-empty">
          <p>Please log in</p>
        </div>
      </div>
    );
  }

  // Active focus session — compact dedicated layout
  if (session) {
    return (
      <CompactFocusSession
        sessionId={session.sessionId}
        taskId={session.taskId}
        taskTitle={session.taskTitle}
        nextAction={session.nextAction}
        plannedMinutes={session.plannedMinutes}
        startedAt={session.startedAt}
        onComplete={() => { markEnded(); }}
        onAbandon={() => { markEnded(); }}
        onSeePlan={handleSeePlan}
        onExpand={handleOpenFullMode}
      />
    );
  }

  // Just finished a session — keep momentum with the post-session prompt.
  // Stays for 10 minutes after the last end, then yields to the day plan.
  const POST_SESSION_WINDOW_MS = 10 * 60 * 1000;
  if (lastEndedAt && Date.now() - lastEndedAt < POST_SESSION_WINDOW_MS) {
    return (
      <CompactNextUp
        date={today}
        onSeePlan={handleSeePlan}
        onExpand={handleOpenFullMode}
        onDismiss={handleDismiss}
        onReflect={handleReflect}
      />
    );
  }

  // No active session — show the day plan (same as existing mini view)
  return (
    <MiniWorkingMode
      date={today}
      onOpenFullMode={handleOpenFullMode}
      standalone={true}
    />
  );
}

export default function MiniWorkingModePage() {
  return (
    <Suspense fallback={
      <div className="mini-wm-container mini-wm-standalone">
        <div className="mini-wm-loading">Loading…</div>
      </div>
    }>
      <MiniWorkingModeContent />
    </Suspense>
  );
}
