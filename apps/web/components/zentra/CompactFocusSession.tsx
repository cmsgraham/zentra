'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { StuckPrompt } from './StuckPrompt';
import { MoveOnPrompt } from './MoveOnPrompt';

interface Props {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  nextAction: string | null;
  plannedMinutes: number;
  startedAt: string;
  onComplete: () => void;
  onAbandon: () => void;
  onSeePlan: () => void;
  onExpand: () => void;
}

function getSecondsRemaining(startedAt: string, plannedMinutes: number): number {
  const start = new Date(startedAt).getTime();
  const end = start + plannedMinutes * 60 * 1000;
  return Math.max(0, Math.floor((end - Date.now()) / 1000));
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const RADIUS = 52;
const CIRC = 2 * Math.PI * RADIUS;

// ── Shared button styles ──────────────────────────────────────
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

export function CompactFocusSession({
  sessionId, taskId, taskTitle, nextAction, plannedMinutes, startedAt,
  onComplete, onAbandon, onSeePlan, onExpand,
}: Props) {
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsRemaining(startedAt, plannedMinutes));
  const [showDonePrompt, setShowDonePrompt] = useState(false);
  const [showStuck, setShowStuck] = useState(false);
  const [showMoveOn, setShowMoveOn] = useState(false);
  const [stuckEventId, setStuckEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState<'complete' | 'abandon' | 'extend' | null>(null);
  const [microSteps, setMicroSteps] = useState<{ order: number; text: string }[] | null>(null);
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getSecondsRemaining(startedAt, plannedMinutes);
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        setShowDonePrompt(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, plannedMinutes]);

  async function handleComplete() {
    setLoading('complete');
    setActionError(null);
    try {
      await api(`/focus/sessions/${sessionId}/complete`, { method: 'PATCH' });
      onComplete();
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      // Session already ended (from another tab / stale state) — still advance.
      if (apiErr?.status === 404) {
        onComplete();
        return;
      }
      console.error('[CompactFocusSession] complete failed', err);
      setActionError(apiErr?.message || 'Could not mark done. Try again.');
    } finally { setLoading(null); }
  }

  async function handleAbandon() {
    // Kept for stuck-prompt compatibility; currently the main UI routes via MoveOnPrompt.
    setLoading('abandon');
    setActionError(null);
    try {
      await api(`/focus/sessions/${sessionId}/abandon`, { method: 'PATCH' });
      onAbandon();
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr?.status === 404) {
        onAbandon();
        return;
      }
      console.error('[CompactFocusSession] abandon failed', err);
      setActionError(apiErr?.message || 'Could not end session. Try again.');
    } finally { setLoading(null); }
  }

  async function handleExtend(minutes: number) {
    setLoading('extend');
    try {
      await api<{ session: unknown }>(`/focus/sessions/${sessionId}/extend`, {
        method: 'PATCH',
        body: JSON.stringify({ additionalMinutes: minutes }),
      });
      window.location.reload();
    } finally { setLoading(null); }
  }

  async function handleStuckOpen() {
    try {
      const res = await api<{ stuckEvent: { id: string } }>('/stuck/events', {
        method: 'POST',
        body: JSON.stringify({ sessionId, taskId }),
      });
      setStuckEventId(res.stuckEvent.id);
    } catch { setStuckEventId(null); }
    setShowStuck(true);
  }

  async function handleStuckResolve(resolvedBy: string) {
    setShowStuck(false);
    if (resolvedBy === 'abandoned' || resolvedBy === 'changed_task') { setShowMoveOn(true); return; }
    if (resolvedBy === 'broke_it_down') {
      setDecomposeLoading(true);
      setDecomposeError(null);
      setMicroSteps(null);
      try {
        const res = await api<{ microSteps: { order: number; text: string }[] }>('/ai/decompose', {
          method: 'POST',
          body: JSON.stringify({ taskId }),
        });
        setMicroSteps(res.microSteps);
      } catch (err: unknown) {
        const apiErr = err as { status?: number };
        setDecomposeError(apiErr?.status === 402
          ? "You've used your 10 free decompositions this month."
          : 'Could not get suggestions. Try again.');
      } finally { setDecomposeLoading(false); }
    }
    // took_a_break / just_started: session keeps running
  }

  const isFinished = secondsLeft === 0;
  const progress = 1 - secondsLeft / (plannedMinutes * 60);
  const offset = CIRC * (1 - progress);
  const hasExtras = microSteps || decomposeLoading || decomposeError;

  return (
    <>
      {/* ── Outer shell: fixed viewport, 3-part column ── */}
      <div style={{
        height: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--wm-bg)',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: 'var(--wm-text)',
      }}>

        {/* ── Top bar ── */}
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

        {/* ── Body: centers timer + task info ── */}
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 20px 8px',
          gap: '12px',
          overflowY: hasExtras ? 'auto' : 'hidden',
        }}>
          {/* Timer ring */}
          <div style={{ position: 'relative', width: '120px', height: '120px', flexShrink: 0 }}>
            <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--ink-surface)" strokeWidth="6" />
              <circle
                cx="60" cy="60" r={RADIUS} fill="none"
                stroke={isFinished ? 'var(--ink-pending)' : 'var(--ink-accent)'}
                strokeWidth="6"
                strokeDasharray={`${CIRC}`}
                strokeDashoffset={`${offset}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '2px',
            }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--ink-text)', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(secondsLeft)}
              </span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--ink-text-muted)' }}>
                {plannedMinutes} min
              </span>
            </div>
          </div>

          {/* Task info */}
          <div style={{ textAlign: 'center', width: '100%' }}>
            <p style={{
              fontSize: '0.9375rem', fontWeight: 600,
              color: 'var(--ink-text)', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              lineHeight: 1.35,
            }}>
              {taskTitle}
            </p>
            {nextAction && (
              <p style={{
                fontSize: '0.8125rem', color: 'var(--ink-text-muted)',
                marginTop: '5px', marginBottom: 0,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
                lineHeight: 1.4,
              }}>
                {nextAction}
              </p>
            )}
          </div>

          {/* Time's up prompt */}
          {(showDonePrompt || isFinished) && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', margin: 0, textAlign: 'center' }}>
              Time's up — mark it done?
            </p>
          )}

          {/* Decompose results (only shown after I'm stuck → break it down) */}
          {decomposeLoading && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', margin: 0 }}>Breaking it down…</p>
          )}
          {decomposeError && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', margin: 0, textAlign: 'center' }}>{decomposeError}</p>
          )}
          {microSteps && microSteps.length > 0 && (
            <div style={{
              width: '100%', background: 'var(--ink-surface)',
              border: '1px solid var(--ink-border)', borderRadius: '10px', padding: '12px',
            }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--ink-text-muted)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Smaller steps
              </p>
              <ol style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {microSteps.map((step) => (
                  <li key={step.order} style={{ fontSize: '0.875rem', color: 'var(--ink-text)', lineHeight: 1.35 }}>{step.text}</li>
                ))}
              </ol>
              <button onClick={() => setMicroSteps(null)} style={{ ...btnGhost, marginTop: '8px', display: 'block' }}>
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* ── Footer: always-visible actions ── */}
        <div style={{
          flexShrink: 0,
          padding: '8px 16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
          borderTop: '1px solid var(--ink-border)',
        }}>
          {actionError && (
            <p style={{ fontSize: '0.75rem', color: 'var(--ink-pending)', margin: 0, textAlign: 'center' }}>
              {actionError}
            </p>
          )}
          {(showDonePrompt || isFinished) ? (
            <>
              <button onClick={handleComplete} disabled={loading !== null} style={btnPrimary}>
                {loading === 'complete' ? '…' : 'Mark done'}
              </button>
              <div style={{ display: 'flex', gap: '7px' }}>
                <button onClick={() => handleExtend(15)} disabled={loading !== null} style={{ ...btnSecondary, flex: 1 }}>+15 min</button>
                <button onClick={() => handleExtend(25)} disabled={loading !== null} style={{ ...btnSecondary, flex: 1 }}>+25 min</button>
              </div>
              <button onClick={() => setShowMoveOn(true)} disabled={loading !== null} style={btnGhostBorder}>
                Move on
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleComplete} disabled={loading !== null} style={{ ...btnPrimary, flex: 1 }}>
                {loading === 'complete' ? '…' : 'Done'}
              </button>
              <button onClick={() => setShowMoveOn(true)} disabled={loading !== null} style={{ ...btnSecondary, flex: 1 }}>
                Move on
              </button>
            </div>
          )}
          {!isFinished && !showDonePrompt && (
            <button onClick={handleStuckOpen} style={{ ...btnGhost, alignSelf: 'center' }}>
              I'm stuck
            </button>
          )}
        </div>
      </div>

      {showStuck && (
        <StuckPrompt
          sessionId={sessionId}
          taskId={taskId}
          stuckEventId={stuckEventId}
          onResolve={handleStuckResolve}
          onClose={() => setShowStuck(false)}
        />
      )}

      {showMoveOn && (
        <MoveOnPrompt
          sessionId={sessionId}
          taskTitle={taskTitle}
          variant="compact"
          onDone={() => { setShowMoveOn(false); onAbandon(); }}
          onCancel={() => setShowMoveOn(false)}
        />
      )}
    </>
  );
}
