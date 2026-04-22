'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

interface Workspace {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
}

export default function MobileDrawer({ open, onClose, workspaces }: Props) {
  const router = useRouter();
  const params = useParams();
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const currentWorkspaceId = params.workspaceId as string | undefined;

  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  function nav(href: string) {
    router.push(href);
    onClose();
  }

  const menuSections = [
    {
      title: 'Spaces',
      items: workspaces.map((ws) => ({
        label: ws.name,
        active: ws.id === currentWorkspaceId,
        action: () => nav(`/workspaces/${ws.id}`),
      })),
    },
    {
      title: 'Tools',
      items: [
        ...(currentWorkspaceId
          ? [
              { label: 'Waiting on…', action: () => nav(`/workspaces/${currentWorkspaceId}/blocked`) },
              { label: 'Archive', action: () => nav(`/workspaces/${currentWorkspaceId}/archive`) },
              { label: 'Text Import', action: () => nav(`/workspaces/${currentWorkspaceId}/import/text`) },
              { label: 'Image Import', action: () => nav(`/workspaces/${currentWorkspaceId}/import/image`) },
            ]
          : []),
        { label: 'Lists', action: () => nav('/lists') },
        { label: 'Friends', action: () => nav('/friends') },
        { label: 'Reminders', action: () => nav('/reminders') },
      ],
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed top-0 left-0 bottom-0 z-50 w-72 overflow-y-auto z-animate-in"
        style={{ background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-lg)' }}
      >
        {/* User header */}
        <div className="px-5 pt-6 pb-4" style={{ borderBottom: '1px solid var(--ink-border-subtle)' }}>
          <img
            src={theme === 'dark' ? '/zentra_nombre_blanco.png' : '/zentra_nombre_azul.png'}
            alt="Zentra"
            className="h-5 mb-3"
          />
          <p className="text-sm font-semibold">{user?.name}</p>
          <p className="z-caption mt-0.5">{user?.email}</p>
        </div>

        {/* Menu sections */}
        {menuSections.map((section) => (
          <div key={section.title} className="px-3 py-3">
            <p className="z-label px-2 mb-1.5">
              {section.title}
            </p>
            {section.items.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] transition-colors"
                style={{
                  color: ('active' in item && item.active) ? 'var(--ink-accent)' : 'var(--ink-text)',
                  fontWeight: ('active' in item && item.active) ? 600 : 400,
                  background: ('active' in item && item.active) ? 'var(--ink-accent-light)' : 'transparent',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}

        {/* Footer actions */}
        <div className="px-3 py-3" style={{ borderTop: '1px solid var(--ink-border-subtle)' }}>
          <button
            onClick={toggleTheme}
            className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] flex items-center justify-between transition-colors"
            style={{ color: 'var(--ink-text)' }}
          >
            <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--ink-text-faint)' }}>
              {theme === 'light' ? (
                <path d="M8 1v1m0 12v1m7-7h-1M2 8H1m12.07-4.07-.71.71M4.64 11.36l-.71.71m9.14 0-.71-.71M4.64 4.64l-.71-.71M12 8a4 4 0 11-8 0 4 4 0 018 0z"/>
              ) : (
                <path d="M14 10a6 6 0 01-9.9-4.6A6 6 0 008 14a6 6 0 006-4z"/>
              )}
            </svg>
          </button>
          <button
            onClick={() => nav('/settings')}
            className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] transition-colors"
            style={{ color: 'var(--ink-text)' }}
          >
            Settings
          </button>
          <button
            onClick={() => { logout().then(() => router.push('/login')); onClose(); }}
            className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] transition-colors"
            style={{ color: 'var(--ink-blocked)' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
