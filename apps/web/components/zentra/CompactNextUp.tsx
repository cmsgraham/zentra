'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { useFocusStore } from '@/lib/useFocusStore';
import { useWorkingSession } from '@/lib/useWorkingSession';
import { listMovedOnTasks } from '@/lib/movedOnTasks';

/**
 * CompactNextUp — post-session "what's next?" prompt.
 *
 * Anti-procrastination flow: as soon as a focus session ends (Done or Stop),
 * the popup keeps the wheel rolling by surfacing the very next task and a
 * one-click Start. No falling back to a passive list view first.
 */

interface Props {
  date: string;
  onSeePlan: () => void;
  onExpand: () => void;
  /** Called when the user wants to drop out of the prompt and see the day plan. */
  onDismiss: () => void;
  /** Optional — called when the user wants to open Reflect. Falls back to onSeePlan. */
  onReflect?: () => void;
}

const REST_SECONDS = 5 * 60;

// ── Shared button styles (mirror CompactFocusSession) ──────────────────
const btnPrimary: React.CSSProperties = {
  padding: '11px 14px',
  background: 'var(--ink-text)',
  color: 'var(--ink-bg)',
  border: 'none',
  borderRadius: '9px',
  fontWeight: 600,
  fontSize: '0.9375rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  padding: '11px 14px',
  background: 'var(--ink-surface)',
  border: '1px solid var(--ink-border)',
  borderRadius: '9px',
  color: 'var(--ink-text)',
  fontSize: '0.9375rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnGhostBorder: React.CSSProperties = {
  padding: '10px 14px',
  background: 'transparent',
  border: '1px solid var(--ink-border)',
  borderRadius: '9px',
  color: 'var(--ink-text-muted)',
  fontSize: '0.875rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnGhost: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--ink-text-muted)',
  fontSize: '0.8125rem',
  cursor: 'pointer',
  padding: '3px 5px',
  fontFamily: 'inherit',
};

function formatMs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CompactNextUp({ date, onSeePlan, onExpand, onDismiss, onReflect }: Props) {
  const { state, derived } = useWorkingSession(date, true);
  const { completedTasks, loaded, blocks } = state;
  const { activeBlock, activeBlockIndex } = derived;

  const startByTitle = useFocusStore((s) => s.startByTitle);

  const [momentum, setMomentum] = useState<{ completedCount: number; totalMinutes: number } | null>(null);
  const [focusDoneTitles, setFocusDoneTitles] = useState<Set<string>>(new Set());
  const [resting, setResting] = useState(false);
  const [restLeft, setRestLeft] = useState(REST_SECONDS);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of the task the user was about to start BEFORE taking the 5-min
  // break. Kept around so that when the break ends we still show the same
  // card, even if the 30s plan poll / currentMinute tick has mutated blocks,
  // completedTasks, or activeBlock under us. Cleared when the user actually
  // starts, cancels the break, or dismisses the prompt.
  const [pendingNext, setPendingNext] = useState<{ title: string; minutes: number; from: 'current' | 'next' } | null>(null);

  // Pick next task: first incomplete task in the active block, else scan
  // every upcoming work block in order. Falls back to null = day complete.
  // Tasks the user already "moved on" from today are excluded so we don't
  // immediately send them back to the same thing.
  const movedOn = useMemo(() => listMovedOnTasks(date), [date, loaded]);
  const next = useMemo<{ title: string; minutes: number; from: 'current' | 'next' } | null>(() => {
    const isAvailable = (t: string) => !completedTasks.has(t) && !movedOn.has(t) && !focusDoneTitles.has(t);
    if (activeBlock) {
      const remaining = activeBlock.tasks.find(isAvailable);
      if (remaining) {
        return { title: remaining, minutes: 25, from: 'current' };
      }
    }
    // Scan all upcoming work blocks (not just the next one).
    const startIdx = activeBlockIndex >= 0 ? activeBlockIndex + 1 : 0;
    for (let i = startIdx; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'break') continue;
      const upcoming = b.tasks.find(isAvailable);
      if (upcoming) {
        return { title: upcoming, minutes: 25, from: 'next' };
      }
    }
    return null;
  }, [activeBlock, activeBlockIndex, blocks, completedTasks, movedOn, focusDoneTitles]);

  // Moved-on tasks that haven't been completed later — available to revisit.
  // Exclude tasks completed via planner goals OR via a focus session (which
  // only updates tasks.status, not daily_plan_goals.status).
  const revisitable = useMemo(() => {
    return Array.from(movedOn).filter((t) => !completedTasks.has(t) && !focusDoneTitles.has(t));
  }, [movedOn, completedTasks, focusDoneTitles]);

  // Load today's momentum once.
  useEffect(() => {
    let cancelled = false;
    api<{ sessions: { taskTitle: string; outcome: string }[]; completedCount: number; totalMinutes: number }>('/focus/sessions/today')
      .then((r) => {
        if (cancelled) return;
        setMomentum({ completedCount: r.completedCount, totalMinutes: r.totalMinutes });
        const doneTitles = new Set(r.sessions.filter((s) => s.outcome === 'completed').map((s) => s.taskTitle));
        setFocusDoneTitles(doneTitles);
      })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, []);

  // Prefer the pre-break snapshot so the post-break card is always consistent
  // with the pre-break one. Falls back to the computed next when no snapshot.
  const displayNext = pendingNext ?? next;

  async function handleStart() {
    if (!displayNext || starting) return;
    setStarting(true);
    setError(null);
    try {
      await startByTitle(displayNext.title, displayNext.minutes);
      setPendingNext(null);
      // startByTitle sets session state → parent will swap to CompactFocusSession.
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.startsWith('TASK_ALREADY_DONE: ')) {
        // Task truly is already marked done — safe to hide and recompute so
        // the next-up card moves on to the next available item.
        const badTitle = msg.slice('TASK_ALREADY_DONE: '.length);
        setFocusDoneTitles((prev) => new Set([...prev, badTitle]));
        setPendingNext(null);
        setResting(false);
        setRestLeft(REST_SECONDS);
        setError('That task was already marked done — showing the next one.');
        setStarting(false);
        return;
      }
      if (msg.startsWith('TASK_NOT_FOUND: ')) {
        // Title couldn't be resolved (e.g. decorated/segment label). Do NOT
        // silently hide it — that makes it look like the task got marked done.
        // Surface the error so the user can decide what to do. Also end the
        // break so the Skip-break timer doesn't keep running while an error
        // is visible.
        const badTitle = msg.slice('TASK_NOT_FOUND: '.length);
        setError(`Couldn't find a task called "${badTitle}". Open your plan to start it manually.`);
        setPendingNext(null);
        setResting(false);
        setRestLeft(REST_SECONDS);
        setStarting(false);
        return;
      }
      setError(msg || 'Could not start. Try again.');
      setStarting(false);
    }
  }

  // Rest countdown — when it hits 0, exit break and return to the same
  // next-up card. We intentionally do NOT auto-start the session because
  // startByTitle may fail (e.g. segment titles) and wrongly mark the task
  // as done, blanking the queue. The user taps Start when they're back.
  useEffect(() => {
    if (!resting) return;
    const id = setInterval(() => {
      setRestLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          setResting(false);
          return REST_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [resting]);

  // ── Loading ────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div className="mini-wm-container mini-wm-standalone">
        <div className="mini-wm-loading">Loading…</div>
      </div>
    );
  }

  // ── Header (shared across all sub-views) ───────────────────
  const Header = (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      borderBottom: '1px solid var(--ink-border)',
      flexShrink: 0,
    }}>
      <button onClick={onSeePlan} style={btnGhost}>← See my plan</button>
      <button onClick={onExpand} title="Open full mode" style={btnGhost}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M9 1h6v6M7 15H1V9" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M15 1L9 7M1 15l6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );

  const MomentumPill = momentum && (momentum.completedCount > 0 || momentum.totalMinutes > 0) ? (
    <div style={{
      fontSize: '0.75rem',
      color: 'var(--ink-text-muted)',
      background: 'var(--ink-surface)',
      border: '1px solid var(--ink-border)',
      borderRadius: '999px',
      padding: '4px 12px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
    }}>
      <span>✓ {momentum.completedCount} done</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{momentum.totalMinutes} min focused</span>
    </div>
  ) : null;

  // ── Day complete state ────────────────────────────────────
  // Don't show the "day complete" screen mid-break — we want the break timer
  // to finish and return to the same next-up card it started from.
  if (!displayNext && !resting) {
    const hasRevisit = revisitable.length > 0;
    const handleRevisit = async (title: string) => {
      if (starting) return;
      setStarting(true);
      setError(null);
      try {
        await startByTitle(title, 25);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.startsWith('TASK_ALREADY_DONE: ')) {
          const badTitle = msg.slice('TASK_ALREADY_DONE: '.length);
          setFocusDoneTitles((prev) => new Set([...prev, badTitle]));
          setStarting(false);
          return;
        }
        if (msg.startsWith('TASK_NOT_FOUND: ')) {
          const badTitle = msg.slice('TASK_NOT_FOUND: '.length);
          setError(`Couldn't find a task called "${badTitle}".`);
          setStarting(false);
          return;
        }
        setError(msg || 'Could not start. Try again.');
        setStarting(false);
      }
    };
    return (
      <div style={{
        height: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--wm-bg)',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: 'var(--wm-text)',
      }}>
        {Header}
        <div style={{
          flex: 1, minHeight: 0,
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center',
          padding: '20px 16px', gap: '14px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginTop: hasRevisit ? 0 : '12px' }}>
            {hasRevisit ? '🫧' : '🎉'}
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            {hasRevisit ? 'Nothing new queued' : 'Plan cleared'}
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', margin: 0, lineHeight: 1.4 }}>
            {hasRevisit
              ? 'Want to pick up something you paused earlier?'
              : 'Nothing else queued for now. Good work.'}
          </p>
          {MomentumPill}
          {hasRevisit && (
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              marginTop: '6px',
            }}>
              {revisitable.slice(0, 4).map((t) => (
                <button
                  key={t}
                  onClick={() => handleRevisit(t)}
                  disabled={starting}
                  style={{
                    ...btnSecondary,
                    textAlign: 'left',
                    fontSize: '0.875rem',
                    padding: '10px 12px',
                    opacity: starting ? 0.6 : 1,
                    cursor: starting ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ opacity: 0.6, marginRight: 6 }}>↻</span>
                  {t}
                </button>
              ))}
              {error && (
                <p style={{ fontSize: '0.75rem', color: 'var(--ink-pending)', margin: 0 }}>{error}</p>
              )}
            </div>
          )}
        </div>
        <div style={{
          flexShrink: 0,
          padding: '8px 16px 14px',
          display: 'flex', flexDirection: 'column', gap: '7px',
          borderTop: '1px solid var(--ink-border)',
        }}>
          <button onClick={onReflect ?? onSeePlan} style={btnPrimary}>Reflect on today</button>
          <button onClick={onDismiss} style={btnGhostBorder}>I&apos;m done for now</button>
        </div>
      </div>
    );
  }

  // ── Resting state (5-min break countdown) ─────────────────
  if (resting) {
    return (
      <div style={{
        height: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--wm-bg)',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: 'var(--wm-text)',
      }}>
        {Header}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '20px', gap: '14px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-text-muted)', margin: 0 }}>
            Quick reset
          </p>
          <div style={{
            fontSize: '2.25rem', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums', color: 'var(--ink-text)',
          }}>
            {formatMs(restLeft)}
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', margin: 0, lineHeight: 1.4 }}>
            Then we start <strong style={{ color: 'var(--ink-text)', fontWeight: 600 }}>{displayNext?.title ?? 'your next task'}</strong>.
          </p>
          {error && (
            <p style={{ fontSize: '0.75rem', color: 'var(--ink-pending)', margin: 0 }}>{error}</p>
          )}
        </div>
        <div style={{
          flexShrink: 0,
          padding: '8px 16px 14px',
          display: 'flex', flexDirection: 'column', gap: '7px',
          borderTop: '1px solid var(--ink-border)',
        }}>
          <button onClick={handleStart} disabled={starting || !displayNext} style={btnPrimary}>
            {starting ? '…' : 'Skip break, start now →'}
          </button>
          <button
            onClick={() => { setResting(false); setRestLeft(REST_SECONDS); setPendingNext(null); }}
            style={btnGhostBorder}
          >
            Cancel break
          </button>
        </div>
      </div>
    );
  }

  // ── Default: next-up prompt ───────────────────────────────
  return (
    <div style={{
      height: '100dvh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--wm-bg)',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: 'var(--wm-text)',
    }}>
      {Header}

      {/* Body */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '16px 20px 8px', gap: '14px',
      }}>
        {/* Just-finished cue + momentum */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', margin: 0 }}>
            ✓ Session ended — keep the momentum
          </p>
          {MomentumPill}
        </div>

        {/* Next-up card */}
        <div style={{
          width: '100%',
          background: 'var(--ink-surface)',
          border: '1px solid var(--ink-border)',
          borderRadius: '12px',
          padding: '14px 14px 12px',
          display: 'flex', flexDirection: 'column', gap: '6px',
        }}>
          <p style={{
            fontSize: '0.6875rem', fontWeight: 600, color: 'var(--ink-text-muted)',
            margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {displayNext!.from === 'current' ? 'Up next in this block' : 'Next up'}
          </p>
          <p style={{
            fontSize: '1rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {displayNext!.title}
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-text-muted)', margin: 0 }}>
            ~{displayNext!.minutes} min focus block
          </p>
        </div>

        {error && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--ink-pending)', margin: 0, textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>

      {/* Footer */}
      <div style={{
        flexShrink: 0,
        padding: '8px 16px 14px',
        display: 'flex', flexDirection: 'column', gap: '7px',
        borderTop: '1px solid var(--ink-border)',
      }}>
        <button onClick={handleStart} disabled={starting} style={btnPrimary}>
          {starting ? 'Starting…' : 'Start →'}
        </button>
        <div style={{ display: 'flex', gap: '7px' }}>
          <button
            onClick={() => {
              // Snapshot the current next-up so the post-break view is stable.
              if (displayNext) setPendingNext(displayNext);
              setRestLeft(REST_SECONDS);
              setResting(true);
            }}
            disabled={starting}
            style={{ ...btnSecondary, flex: 1 }}
          >
            Take 5
          </button>
          <button
            onClick={() => { setPendingNext(null); onDismiss(); }}
            disabled={starting}
            style={{ ...btnSecondary, flex: 1 }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
