'use client';

interface Props {
  title: string;
  onMenuPress: () => void;
  rightAction?: { label: string; onClick: () => void };
  logoSrc?: string;
}

export default function MobileTopBar({ title, onMenuPress, rightAction, logoSrc }: Props) {
  return (
    <header
      className="flex items-center justify-between px-4 h-12 shrink-0"
      style={{ background: 'var(--ink-surface)', borderBottom: '1px solid var(--ink-border-subtle)' }}
    >
      <button
        onClick={onMenuPress}
        className="z-btn-icon -ml-1"
        style={{ color: 'var(--ink-text-secondary)' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="3" y1="4.5" x2="15" y2="4.5"/><line x1="3" y1="9" x2="15" y2="9"/><line x1="3" y1="13.5" x2="15" y2="13.5"/>
        </svg>
      </button>
      {logoSrc ? (
        <img src={logoSrc} alt="Zentra" className="h-6 mx-auto" />
      ) : (
        <h1 className="text-[13px] font-semibold truncate flex-1 text-center mx-2" style={{ letterSpacing: '-0.01em' }}>{title}</h1>
      )}
      {rightAction ? (
        <button
          onClick={rightAction.onClick}
          className="z-btn-icon -mr-1"
          style={{ color: 'var(--ink-accent)' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <line x1="9" y1="3" x2="9" y2="15"/><line x1="3" y1="9" x2="15" y2="9"/>
          </svg>
        </button>
      ) : (
        <div className="w-8" />
      )}
    </header>
  );
}
