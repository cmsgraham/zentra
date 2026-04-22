'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';

interface StuckPromptProps {
  sessionId: string;
  taskId: string;
  stuckEventId: string | null;
  onResolve: (resolvedBy: string) => void;
  onClose: () => void;
}

const OPTIONS = [
  { value: 'broke_it_down', label: 'Break it into smaller steps', description: 'Get AI help splitting this up' },
  { value: 'changed_task', label: 'Work on something else', description: 'Switch to a different intention' },
  { value: 'took_a_break', label: 'Take a short break', description: 'Come back in a few minutes' },
  { value: 'just_started', label: 'I found a way to start', description: 'Continue the session' },
  { value: 'abandoned', label: 'End this session', description: 'Stop working for now' },
];

export function StuckPrompt({ sessionId, taskId, stuckEventId, onResolve, onClose }: StuckPromptProps) {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleOption(value: string) {
    setLoading(value);
    try {
      if (stuckEventId) {
        await api(`/stuck/events/${stuckEventId}/resolve`, {
          method: 'PATCH',
          body: JSON.stringify({ resolvedBy: value }),
        });
      }
      onResolve(value);
    } catch {
      // Continue even if network fails; UI should proceed
      onResolve(value);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="I'm stuck"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
        padding: '0 0 env(safe-area-inset-bottom) 0',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ink-surface)',
          borderRadius: '16px 16px 0 0',
          padding: '24px 20px 32px',
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <p
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--ink-text)',
            margin: '0 0 8px',
          }}
        >
          What's going on?
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', margin: '0 0 12px' }}>
          Pick what fits best.
        </p>
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleOption(opt.value)}
            disabled={loading !== null}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: '14px 16px',
              background: 'var(--ink-bg)',
              border: '1px solid var(--ink-border)',
              borderRadius: '10px',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              opacity: loading && loading !== opt.value ? 0.5 : 1,
            }}
          >
            <span style={{ fontWeight: 500, color: 'var(--ink-text)', fontSize: '0.9375rem' }}>
              {loading === opt.value ? '...' : opt.label}
            </span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--ink-text-muted)', marginTop: '2px' }}>
              {opt.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
