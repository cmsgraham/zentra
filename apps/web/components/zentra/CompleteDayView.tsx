'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

interface SuggestedTask {
  id: string;
  title: string;
  nextAction?: string | null;
  nextActionState?: 'unclear' | 'set' | 'done';
}

interface CompleteDayViewProps {
  completedCount: number;
  totalMinutes: number;
  onAddAnother: () => void;
  onStartSuggested?: (task: SuggestedTask) => void;
}

export function CompleteDayView({ completedCount, totalMinutes, onAddAnother, onStartSuggested }: CompleteDayViewProps) {
  const router = useRouter();
  const [nextTitle, setNextTitle] = useState<string | null>(null);
  const [nextTask, setNextTask] = useState<SuggestedTask | null>(null);
  const [priming, setPriming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{
          suggestion: SuggestedTask | null;
          suggestionText?: string | null;
        }>('/priority/suggest', { method: 'POST' });
        if (cancelled) return;
        setNextTask(res.suggestion ?? null);
        const title = res.suggestion?.title ?? res.suggestionText ?? null;
        setNextTitle(title);
      } catch {
        if (!cancelled) {
          setNextTask(null);
          setNextTitle(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleNextUpClick() {
    if (priming) return;
    if (nextTask?.id && onStartSuggested) {
      setPriming(true);
      try {
        await api('/priority/today', {
          method: 'POST',
          body: JSON.stringify({ taskId: nextTask.id }),
        });
        onStartSuggested({
          id: nextTask.id,
          title: nextTask.title,
          nextAction: nextTask.nextAction ?? null,
          nextActionState: nextTask.nextActionState ?? 'unclear',
        });
      } catch {
        // Fall back to the chooser if priming failed
        onAddAnother();
      } finally {
        setPriming(false);
      }
      return;
    }
    onAddAnother();
  }

  // Detect whether we're inside the detached mini-working popup. When so,
  // navigate the opener window and close this one instead of routing in-place.
  const navigate = (path: string) => {
    if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
      try {
        window.opener.location.href = path;
        window.opener.focus();
      } catch { /* cross-origin guard */ }
      window.close();
      return;
    }
    router.push(path);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '36px',
        padding: '72px 24px',
        textAlign: 'center',
        maxWidth: '440px',
        margin: '0 auto',
      }}
    >
      <div>
        <p
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            color: 'var(--ink-text)',
            margin: '0 0 8px',
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
          }}
        >
          That was the one thing.
          <br />
          Nice work.
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--ink-text-muted)', margin: 0 }}>
          {completedCount} {completedCount === 1 ? 'session' : 'sessions'} · {totalMinutes} minutes focused
        </p>
      </div>

      {nextTitle && (
        <button
          type="button"
          onClick={handleNextUpClick}
          disabled={priming}
          style={{
            width: '100%',
            padding: '20px 20px',
            background: 'var(--ink-surface)',
            border: '1px solid var(--ink-border)',
            borderRadius: '14px',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            transition: 'background 120ms ease, border-color 120ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--ink-surface-hover, var(--ink-surface))';
            e.currentTarget.style.borderColor = 'var(--ink-text-muted)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--ink-surface)';
            e.currentTarget.style.borderColor = 'var(--ink-border)';
          }}
          aria-label={`Start next task: ${nextTitle}`}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--ink-text-muted)',
                marginBottom: '6px',
              }}
            >
              Next up
            </div>
            <div
              style={{
                fontSize: '1.0625rem',
                fontWeight: 500,
                color: 'var(--ink-text)',
                lineHeight: 1.35,
              }}
            >
              {nextTitle}
            </div>
          </div>
          <span
            aria-hidden
            style={{
              fontSize: '1.125rem',
              color: 'var(--ink-text-muted)',
              lineHeight: 1,
            }}
          >
            ›
          </span>
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%', alignItems: 'center' }}>
        <button
          onClick={onAddAnother}
          style={{
            width: '100%',
            padding: '16px',
            background: 'var(--ink-text)',
            border: 'none',
            borderRadius: '12px',
            color: 'var(--ink-bg)',
            fontSize: '0.9375rem',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '-0.005em',
          }}
        >
          Start next task
        </button>
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--ink-text-muted)',
            letterSpacing: '0.04em',
            textTransform: 'lowercase',
          }}
        >
          — or —
        </div>
        <button
          onClick={() => navigate('/reflect')}
          style={{
            padding: '6px 8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-text-muted)',
            fontSize: '0.875rem',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          Finish your day with a quick reflection
        </button>
      </div>
    </div>
  );
}
