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
        color: 'var(--ink-bg)',
        background: loading || disabled ? 'var(--ink-text-muted)' : 'var(--ink-text)',
        border: 'none',
        borderRadius: '12px',
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        transition: 'transform 80ms ease, background 120ms ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
      }}
    >
      {loading ? 'Starting...' : `Start · ${plannedMinutes} min`}
    </button>
  );
}
