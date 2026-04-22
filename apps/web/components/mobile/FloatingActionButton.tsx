'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface FABAction {
  label: string;
  icon: string;
  href?: string;
  onClick?: () => void;
}

interface Props {
  actions: FABAction[];
}

export default function FloatingActionButton({ actions }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleAction(action: FABAction) {
    setOpen(false);
    if (action.href) router.push(action.href);
    else if (action.onClick) action.onClick();
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={() => setOpen(false)} />
      )}

      {/* Action menu */}
      {open && (
        <div className="fixed right-4 z-50 flex flex-col items-end gap-2 z-animate-in" style={{ bottom: '128px' }}>
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleAction(action)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-medium z-panel"
              style={{ boxShadow: 'var(--ink-shadow-md)' }}
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 z-50 w-13 h-13 rounded-full flex items-center justify-center transition-all"
        style={{
          bottom: '72px',
          background: 'var(--ink-accent)',
          color: 'var(--ink-on-accent)',
          boxShadow: 'var(--ink-shadow-md)',
          transform: open ? 'rotate(45deg)' : 'none',
          width: '52px',
          height: '52px',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="11" y1="4" x2="11" y2="18"/><line x1="4" y1="11" x2="18" y2="11"/>
        </svg>
      </button>
    </>
  );
}
