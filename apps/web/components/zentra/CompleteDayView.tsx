'use client';

import { useRouter } from 'next/navigation';

interface CompleteDayViewProps {
  completedCount: number;
  totalMinutes: number;
  onAddAnother: () => void;
}

export function CompleteDayView({ completedCount, totalMinutes, onAddAnother }: CompleteDayViewProps) {
  const router = useRouter();

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
        gap: '28px',
        padding: '60px 24px',
        textAlign: 'center',
        maxWidth: '400px',
        margin: '0 auto',
      }}
    >
      <div>
        <p
          style={{
            fontSize: '1.375rem',
            fontWeight: 600,
            color: 'var(--ink-text)',
            margin: '0 0 10px',
            lineHeight: 1.35,
          }}
        >
          That was the one thing.
          <br />
          You did it.
        </p>
        <p style={{ fontSize: '0.9375rem', color: 'var(--ink-text-muted)', margin: 0 }}>
          {completedCount} {completedCount === 1 ? 'session' : 'sessions'} · {totalMinutes} minutes focused
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/reflect')}
          style={{
            width: '100%',
            padding: '14px',
            background: 'var(--ink-text)',
            border: 'none',
            borderRadius: '10px',
            color: 'var(--ink-bg)',
            fontSize: '0.9375rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Close the day
        </button>
        <button
          onClick={onAddAnother}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-text-muted)',
            fontSize: '0.8125rem',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          Not done yet — add another intention
        </button>
      </div>
    </div>
  );
}
