'use client';

interface StartButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  plannedMinutes?: number;
}

export function StartButton({ onClick, loading, disabled, plannedMinutes = 25 }: StartButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%',
        maxWidth: '400px',
        padding: '18px 0',
        fontSize: '1.125rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: 'var(--ink-on-accent)',
        background: loading || disabled ? 'var(--ink-text-muted)' : 'var(--ink-accent)',
        border: 'none',
        borderRadius: '999px',
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        transition: 'transform 80ms ease, background 120ms ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        boxShadow:
          loading || disabled
            ? 'none'
            : '0 1px 2px color-mix(in srgb, var(--ink-accent) 20%, transparent), 0 12px 32px -12px color-mix(in srgb, var(--ink-accent) 45%, transparent)',
      }}
      onMouseEnter={(e) => {
        if (loading || disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--ink-accent-hover)';
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        if (!(loading || disabled)) {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--ink-accent)';
        }
      }}
    >
      {loading ? 'Starting...' : `Start · ${plannedMinutes} min`}
    </button>
  );
}
