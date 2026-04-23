'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { addMovedOnTask } from '@/lib/movedOnTasks';

export type MoveOnReason =
  | 'ran_out_of_time'
  | 'lost_focus'
  | 'blocked'
  | 'priority_shift'
  | 'too_big'
  | 'not_worth_it';

interface Props {
  sessionId: string;
  taskTitle: string;
  onDone: () => void;
  onCancel: () => void;
  /** Visual layout. "compact" = fits inside 360×480 popup. "full" = full-page focus view. */
  variant?: 'compact' | 'full';
}

const REASONS: { key: MoveOnReason; label: string; sub: string }[] = [
  { key: 'ran_out_of_time', label: 'Ran out of time',        sub: "I'll pick it back up" },
  { key: 'lost_focus',      label: 'Lost focus',             sub: 'Need a reset' },
  { key: 'blocked',         label: 'Hit a blocker',          sub: 'Waiting on something' },
  { key: 'priority_shift',  label: 'Something else came up', sub: 'Priorities shifted' },
  { key: 'too_big',         label: 'Bigger than I thought',  sub: 'Needs breaking down' },
  { key: 'not_worth_it',    label: 'Not worth doing',        sub: "Letting it go" },
];

/**
 * MoveOnPrompt — self-justification dialog shown when the user taps "Move on"
 * (formerly "Abandon"). Captures an optional reason + short note and ends the
 * focus session. Designed for gentle, self-kind reflection — not a boss report.
 */
export function MoveOnPrompt({ sessionId, taskTitle, onDone, onCancel, variant = 'compact' }: Props) {
  const [reason, setReason] = useState<MoveOnReason | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(selected?: MoveOnReason | null) {
    const finalReason = selected !== undefined ? selected : reason;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (finalReason) body.reason = finalReason;
      if (note.trim()) body.note = note.trim();
      await api(`/focus/sessions/${sessionId}/abandon`, {
        method: 'PATCH',
        body: Object.keys(body).length ? JSON.stringify(body) : undefined,
      });
      // Remember for the rest of today so the next-up prompt skips it.
      try { addMovedOnTask(taskTitle); } catch { /* non-critical */ }
      onDone();
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      // Session already ended elsewhere — still advance.
      if (apiErr?.status === 404) { onDone(); return; }
      console.error('[MoveOnPrompt] submit failed', err);
      setError(apiErr?.message || 'Could not save. Try again.');
      setSaving(false);
    }
  }

  const isCompact = variant === 'compact';

  const dialog = (
    <div
      role="dialog"
      aria-label="How did it go?"
      style={{
        position: isCompact ? 'absolute' : 'relative',
        inset: isCompact ? 0 : undefined,
        width: isCompact ? undefined : 'min(420px, calc(100vw - 32px))',
        maxHeight: isCompact ? undefined : 'min(640px, calc(100vh - 32px))',
        background: 'var(--wm-bg, var(--ink-bg))',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: isCompact ? 0 : '14px',
        border: isCompact ? 'none' : '1px solid var(--ink-border)',
        boxShadow: isCompact ? 'none' : '0 20px 60px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        zIndex: 50,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{
        flexShrink: 0,
        padding: isCompact ? '14px 16px 8px' : '20px 24px 10px',
        borderBottom: '1px solid var(--ink-border)',
      }}>
        <p style={{
          margin: 0,
          fontSize: isCompact ? '0.6875rem' : '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--ink-text-muted)',
        }}>
          Moving on from
        </p>
        <p style={{
          margin: '4px 0 0',
          fontSize: isCompact ? '0.9375rem' : '1.125rem',
          fontWeight: 600,
          color: 'var(--ink-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {taskTitle}
        </p>
        <p style={{
          margin: '10px 0 0',
          fontSize: isCompact ? '0.9375rem' : '1rem',
          color: 'var(--ink-text)',
          fontWeight: 500,
        }}>
          How did it go?
        </p>
        <p style={{
          margin: '2px 0 0',
          fontSize: isCompact ? '0.75rem' : '0.8125rem',
          color: 'var(--ink-text-muted)',
        }}>
          Just for you — pick one, or skip.
        </p>
      </div>

      {/* Reason chips */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: isCompact ? '10px 16px' : '14px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
      }}>
        {REASONS.map((r) => {
          const active = reason === r.key;
          return (
            <button
              key={r.key}
              onClick={() => setReason(active ? null : r.key)}
              disabled={saving}
              style={{
                textAlign: 'left',
                padding: isCompact ? '9px 12px' : '12px 14px',
                background: active ? 'var(--ink-text)' : 'var(--ink-surface)',
                color: active ? 'var(--ink-bg)' : 'var(--ink-text)',
                border: `1px solid ${active ? 'var(--ink-text)' : 'var(--ink-border)'}`,
                borderRadius: '9px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'background 120ms, color 120ms, border-color 120ms',
              }}
            >
              <div style={{
                fontSize: isCompact ? '0.875rem' : '0.9375rem',
                fontWeight: 600,
              }}>
                {r.label}
              </div>
              <div style={{
                fontSize: isCompact ? '0.75rem' : '0.8125rem',
                opacity: 0.75,
                marginTop: '1px',
              }}>
                {r.sub}
              </div>
            </button>
          );
        })}

        {/* Optional note */}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          placeholder="Anything to remember? (optional)"
          disabled={saving}
          rows={isCompact ? 2 : 3}
          style={{
            marginTop: '4px',
            padding: '9px 11px',
            background: 'var(--ink-bg)',
            border: '1px solid var(--ink-border)',
            borderRadius: '9px',
            color: 'var(--ink-text)',
            fontSize: isCompact ? '0.8125rem' : '0.875rem',
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
          }}
        />
      </div>

      {/* Footer */}
      <div style={{
        flexShrink: 0,
        padding: isCompact ? '10px 16px 14px' : '16px 24px 20px',
        borderTop: '1px solid var(--ink-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
      }}>
        {error && (
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-pending)', margin: 0, textAlign: 'center' }}>
            {error}
          </p>
        )}
        <button
          onClick={() => submit()}
          disabled={saving}
          style={{
            padding: '11px 14px',
            background: 'var(--ink-accent)',
            color: 'var(--ink-on-accent)',
            border: 'none',
            borderRadius: '999px',
            fontWeight: 600,
            fontSize: '0.9375rem',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? '…' : 'Move on'}
        </button>
        <div style={{ display: 'flex', gap: '7px' }}>
          <button
            onClick={() => submit(null)}
            disabled={saving}
            style={{
              flex: 1,
              padding: '9px 14px',
              background: 'transparent',
              border: '1px solid var(--ink-border)',
              borderRadius: '9px',
              color: 'var(--ink-text-muted)',
              fontSize: '0.8125rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Skip, just end it
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              flex: 1,
              padding: '9px 14px',
              background: 'transparent',
              border: '1px solid var(--ink-border)',
              borderRadius: '9px',
              color: 'var(--ink-text-muted)',
              fontSize: '0.8125rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Keep going
          </button>
        </div>
      </div>
    </div>
  );

  if (isCompact) return dialog;

  // Full variant: render as a centered floating card over a dimmed backdrop.
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}
    >
      {dialog}
    </div>
  );
}
