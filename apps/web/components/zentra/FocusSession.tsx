'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { StuckPrompt } from './StuckPrompt';
import { MoveOnPrompt } from './MoveOnPrompt';

interface FocusSessionProps {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  nextAction: string | null;
  plannedMinutes: number;
  startedAt: string;
  onComplete: () => void;
  onAbandon: () => void;
}

function getSecondsRemaining(startedAt: string, plannedMinutes: number): number {
  const start = new Date(startedAt).getTime();
  const end = start + plannedMinutes * 60 * 1000;
  const remaining = Math.floor((end - Date.now()) / 1000);
  return Math.max(0, remaining);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function FocusSession({
  sessionId,
  taskId,
  taskTitle,
  nextAction,
  plannedMinutes,
  startedAt,
  onComplete,
  onAbandon,
}: FocusSessionProps) {
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsRemaining(startedAt, plannedMinutes));
  const [showDonePrompt, setShowDonePrompt] = useState(false);
  const [showStuck, setShowStuck] = useState(false);
  const [showMoveOn, setShowMoveOn] = useState(false);
  const [stuckEventId, setStuckEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState<'complete' | 'abandon' | 'extend' | null>(null);
  const [microSteps, setMicroSteps] = useState<{ order: number; text: string }[] | null>(null);
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);
  // Flow safeguards: cap repeated extensions and stuck events within one session
  const EXTENSION_LIMIT = 3;
  const STUCK_LIMIT = 3;
  const [extensionCount, setExtensionCount] = useState(0);
  const [stuckCount, setStuckCount] = useState(0);
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const [showStuckLimit, setShowStuckLimit] = useState(false);

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
    try {
      await api(`/focus/sessions/${sessionId}/complete`, { method: 'PATCH' });
      onComplete();
    } finally {
      setLoading(null);
    }
  }

  async function handleAbandon() {
    setLoading('abandon');
    try {
      await api(`/focus/sessions/${sessionId}/abandon`, { method: 'PATCH' });
      onAbandon();
    } finally {
      setLoading(null);
    }
  }

  async function handleExtend(minutes: number) {
    // Gate extensions: after EXTENSION_LIMIT, surface a checkpoint instead of silently extending
    if (extensionCount >= EXTENSION_LIMIT) {
      setShowCheckpoint(true);
      return;
    }
    setLoading('extend');
    try {
      await api<{ session: any }>(`/focus/sessions/${sessionId}/extend`, {
        method: 'PATCH',
        body: JSON.stringify({ additionalMinutes: minutes }),
      });
      setExtensionCount((n) => n + 1);
      window.location.reload(); // New session ID — reload state
    } finally {
      setLoading(null);
    }
  }

  async function handleCheckpointContinue(minutes: number) {
    // One more extension granted after reflection
    setShowCheckpoint(false);
    setLoading('extend');
    try {
      await api<{ session: any }>(`/focus/sessions/${sessionId}/extend`, {
        method: 'PATCH',
        body: JSON.stringify({ additionalMinutes: minutes }),
      });
      setExtensionCount((n) => n + 1);
      window.location.reload();
    } finally {
      setLoading(null);
    }
  }

  async function handleStuckOpen() {
    // Gate repeated stuck events: after STUCK_LIMIT, surface a nudge instead of reopening the same prompt
    if (stuckCount >= STUCK_LIMIT) {
      setShowStuckLimit(true);
      return;
    }
    try {
      const res = await api<{ stuckEvent: { id: string } }>('/stuck/events', {
        method: 'POST',
        body: JSON.stringify({ sessionId, taskId }),
      });
      setStuckEventId(res.stuckEvent.id);
    } catch {
      setStuckEventId(null);
    }
    setStuckCount((n) => n + 1);
    setShowStuck(true);
  }

  async function handleStuckResolve(resolvedBy: string) {
    setShowStuck(false);
    if (resolvedBy === 'abandoned') { setShowMoveOn(true); return; }
    if (resolvedBy === 'changed_task') { setShowMoveOn(true); return; }
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
      } catch (err: any) {
        setDecomposeError(err?.status === 402 ? 'You\'ve used your 10 free decompositions this month.' : 'Could not get suggestions. Try again.');
      } finally {
        setDecomposeLoading(false);
      }
    }
    // took_a_break / just_started: session keeps running
  }

  const isFinished = secondsLeft === 0;
  const progress = 1 - secondsLeft / (plannedMinutes * 60);

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '28px',
          padding: '40px 24px',
          maxWidth: '400px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Timer ring */}
        <div style={{ position: 'relative', width: '200px', height: '200px' }}>
          <svg width="200" height="200" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="100" cy="100" r="88" fill="none" stroke="var(--ink-surface)" strokeWidth="8" />
            <circle
              cx="100"
              cy="100"
              r="88"
              fill="none"
              stroke={isFinished ? 'var(--ink-pending)' : 'var(--ink-accent)'}
              strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 88}`}
              strokeDashoffset={`${2 * Math.PI * 88 * (1 - progress)}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '2.25rem', fontWeight: 700, color: 'var(--ink-text)', fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(secondsLeft)}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-text-muted)' }}>
              {plannedMinutes} min
            </span>
          </div>
        </div>

        {/* Task info */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0 }}>
            {taskTitle}
          </p>
          {nextAction && (
            <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', marginTop: '6px' }}>
              {nextAction}
            </p>
          )}
        </div>

        {/* Controls */}
        {(showDonePrompt || isFinished) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <p style={{ textAlign: 'center', color: 'var(--ink-text-muted)', fontSize: '0.875rem', margin: 0 }}>
              Time's up. Do you want to mark this done?
            </p>
            <button
              onClick={handleComplete}
              disabled={loading !== null}
              style={{ padding: '14px', background: 'var(--ink-text)', color: 'var(--ink-bg)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              {loading === 'complete' ? '...' : 'Mark done'}
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleExtend(15)}
                disabled={loading !== null}
                style={{ flex: 1, padding: '12px', background: 'var(--ink-surface)', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text)', cursor: 'pointer' }}
              >
                +15 min
              </button>
              <button
                onClick={() => handleExtend(25)}
                disabled={loading !== null}
                style={{ flex: 1, padding: '12px', background: 'var(--ink-surface)', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text)', cursor: 'pointer' }}
              >
                +25 min
              </button>
            </div>
            <button
              onClick={() => setShowMoveOn(true)}
              disabled={loading !== null}
              style={{ padding: '12px', background: 'transparent', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text-muted)', cursor: 'pointer' }}
            >
              Move on
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button
              onClick={handleComplete}
              disabled={loading !== null}
              style={{ flex: 1, padding: '14px', background: 'var(--ink-text)', color: 'var(--ink-bg)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              {loading === 'complete' ? '...' : 'Done'}
            </button>
            <button
              onClick={() => setShowMoveOn(true)}
              disabled={loading !== null}
              style={{ flex: 1, padding: '14px', background: 'var(--ink-surface)', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text)', cursor: 'pointer' }}
            >
              Move on
            </button>
          </div>
        )}

        {/* Decompose results */}
        {decomposeLoading && (
          <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', textAlign: 'center', margin: 0 }}>Breaking it down...</p>
        )}
        {decomposeError && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', textAlign: 'center', margin: 0 }}>{decomposeError}</p>
        )}
        {microSteps && microSteps.length > 0 && (
          <div style={{ width: '100%', background: 'var(--ink-surface)', border: '1px solid var(--ink-border)', borderRadius: '12px', padding: '16px' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Smaller steps</p>
            <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {microSteps.map((step) => (
                <li key={step.order} style={{ fontSize: '0.9375rem', color: 'var(--ink-text)', lineHeight: 1.4 }}>{step.text}</li>
              ))}
            </ol>
            <button
              onClick={() => setMicroSteps(null)}
              style={{ marginTop: '12px', background: 'none', border: 'none', color: 'var(--ink-text-muted)', fontSize: '0.8125rem', cursor: 'pointer', padding: 0 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stuck button */}
        {!isFinished && !showDonePrompt && (
          <button
            onClick={handleStuckOpen}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink-text-muted)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              opacity: 0.6,
              padding: '4px 0',
            }}
          >
            I'm stuck
          </button>
        )}
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
          variant="full"
          onDone={() => { setShowMoveOn(false); onAbandon(); }}
          onCancel={() => setShowMoveOn(false)}
        />
      )}

      {showCheckpoint && (
        <div
          role="dialog"
          aria-label="Checkpoint"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
          }}
          onClick={() => setShowCheckpoint(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '440px', background: 'var(--ink-bg)',
              borderTopLeftRadius: '20px', borderTopRightRadius: '20px',
              padding: '28px 24px 24px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}
          >
            <div>
              <p style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0 }}>
                You've extended a few times.
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', margin: '6px 0 0' }}>
                Quick check-in before you keep going.
              </p>
            </div>
            <button
              onClick={() => handleCheckpointContinue(15)}
              style={{ padding: '14px', background: 'var(--ink-text)', color: 'var(--ink-bg)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Continue once more (+15 min)
            </button>
            <button
              onClick={() => { setShowCheckpoint(false); setShowMoveOn(true); }}
              style={{ padding: '12px', background: 'var(--ink-surface)', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text)', cursor: 'pointer' }}
            >
              Move on
            </button>
            <button
              onClick={() => { setShowCheckpoint(false); setShowDonePrompt(false); }}
              style={{ padding: '12px', background: 'transparent', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text-muted)', cursor: 'pointer' }}
            >
              Adjust next action
            </button>
            <a
              href="/reflect"
              style={{ padding: '10px', textAlign: 'center', color: 'var(--ink-text-muted)', fontSize: '0.875rem', textDecoration: 'none' }}
            >
              Reflect on today
            </a>
          </div>
        </div>
      )}

      {showStuckLimit && (
        <div
          role="dialog"
          aria-label="Still stuck"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
          }}
          onClick={() => setShowStuckLimit(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '440px', background: 'var(--ink-bg)',
              borderTopLeftRadius: '20px', borderTopRightRadius: '20px',
              padding: '28px 24px 24px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}
          >
            <div>
              <p style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0 }}>
                Still stuck?
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', margin: '6px 0 0' }}>
                Sometimes the task or the priority needs to shift.
              </p>
            </div>
            <button
              onClick={() => { setShowStuckLimit(false); setShowMoveOn(true); }}
              style={{ padding: '14px', background: 'var(--ink-text)', color: 'var(--ink-bg)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Change task
            </button>
            <button
              onClick={() => { setShowStuckLimit(false); onAbandon(); }}
              style={{ padding: '12px', background: 'var(--ink-surface)', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text)', cursor: 'pointer' }}
            >
              Change priority
            </button>
            <button
              onClick={() => setShowStuckLimit(false)}
              style={{ padding: '12px', background: 'transparent', border: '1px solid var(--ink-border)', borderRadius: '10px', color: 'var(--ink-text-muted)', cursor: 'pointer' }}
            >
              Push through
            </button>
          </div>
        </div>
      )}
    </>
  );
}
