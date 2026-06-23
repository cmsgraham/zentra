'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
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

/* ---------- Icons (compact, monochrome) ---------- */
const Icon = {
  flow: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" />
    </svg>
  ),
  reflect: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 012-2h11l3 3v13a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  ),
  planner: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  ),
  allSpaces: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  waiting: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  archive: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
    </svg>
  ),
  textImport: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><polyline points="14 3 14 9 20 9" /><path d="M8 13h8M8 17h6" />
    </svg>
  ),
  imageImport: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" />
    </svg>
  ),
  lists: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />
    </svg>
  ),
  budget: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/><path d="M16.5 17.5c1 0 1.5-.5 1.5-1.2 0-.8-.6-1.1-1.5-1.3-.8-.2-1.2-.4-1.2-.9 0-.5.4-.8 1-.8.6 0 1 .2 1.3.6"/>
    </svg>
  ),
  friends: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0119 7a4 4 0 01-3 3.87" />
    </svg>
  ),
  echoes: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" />
    </svg>
  ),
  huddles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h10"/><path d="M4 12h16"/><path d="M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  help: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12" y2="17" />
    </svg>
  ),
  signOut: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  sun: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  moon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  ),
};

/* ---------- Workspace dot color (deterministic from id) ---------- */
function workspaceColor(id: string): string {
  const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#84cc16'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

interface RowProps {
  icon?: React.ReactNode;
  leading?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}

function Row({ icon, leading, label, trailing, active, danger, onClick }: RowProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] transition-colors"
      style={{
        color: danger ? 'var(--ink-blocked)' : active ? 'var(--ink-accent)' : 'var(--ink-text)',
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--ink-accent-light)' : 'transparent',
      }}
    >
      <span
        className="flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          color: danger ? 'var(--ink-blocked)' : active ? 'var(--ink-accent)' : 'var(--ink-text-faint)',
          flexShrink: 0,
        }}
      >
        {leading ?? icon}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
      {trailing}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="px-3 mb-1.5 mt-1"
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink-text-faint)',
      }}
    >
      {children}
    </p>
  );
}

export default function MobileDrawer({ open, onClose, workspaces }: Props) {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname() ?? '';
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const currentWorkspaceId = params.workspaceId as string | undefined;
  const isOnAllSpaces = pathname.startsWith('/workspaces/all');

  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [workspaces],
  );

  if (!open) return null;

  function nav(href: string) {
    router.push(href);
    onClose();
  }

  const initials = (user?.name || user?.email || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={onClose} />

      {/* Drawer */}
      <aside
        className="fixed top-0 left-0 bottom-0 z-50 w-[290px] flex flex-col z-animate-in"
        style={{ background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-lg)' }}
      >
        {/* User header */}
        <div className="px-4 pt-5 pb-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--ink-border-subtle)' }}>
          <div
            className="flex items-center justify-center text-[13px] font-semibold"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'var(--ink-accent-light)',
              color: 'var(--ink-accent)',
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold truncate">{user?.name}</p>
            <p className="z-caption mt-0.5 truncate">{user?.email}</p>
          </div>
        </div>

        {/* Scrollable middle */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* Quick actions */}
          <div className="px-2 pb-1">
            <SectionLabel>Daily</SectionLabel>
            <Row icon={Icon.flow} label="Flow — Today" active={pathname === '/today'} onClick={() => nav('/today')} />
            <Row icon={Icon.planner} label="Planner" active={pathname.startsWith('/planner')} onClick={() => nav('/planner')} />
            <Row icon={Icon.reflect} label="Reflect" active={pathname === '/reflect'} onClick={() => nav('/reflect')} />
          </div>

          {/* Spaces */}
          <div className="px-2 pt-2 pb-1" style={{ borderTop: '1px solid var(--ink-border-subtle)' }}>
            <SectionLabel>Spaces</SectionLabel>
            {workspaces.length > 1 && (
              <Row
                icon={Icon.allSpaces}
                label="All spaces"
                active={isOnAllSpaces}
                onClick={() => nav('/workspaces/all')}
              />
            )}
            {sortedWorkspaces.map((ws) => (
              <Row
                key={ws.id}
                leading={
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: workspaceColor(ws.id),
                      display: 'inline-block',
                    }}
                  />
                }
                label={ws.name}
                active={ws.id === currentWorkspaceId && !isOnAllSpaces}
                onClick={() => nav(`/workspaces/${ws.id}`)}
              />
            ))}
          </div>

          {/* In this space */}
          {currentWorkspaceId && !isOnAllSpaces && (
            <div className="px-2 pt-2 pb-1" style={{ borderTop: '1px solid var(--ink-border-subtle)' }}>
              <SectionLabel>In this space</SectionLabel>
              <Row icon={Icon.waiting} label="Waiting on…" onClick={() => nav(`/workspaces/${currentWorkspaceId}/blocked`)} />
              <Row icon={Icon.archive} label="Archive" onClick={() => nav(`/workspaces/${currentWorkspaceId}/archive`)} />
              <Row icon={Icon.textImport} label="Import from text" onClick={() => nav(`/workspaces/${currentWorkspaceId}/import/text`)} />
              <Row icon={Icon.imageImport} label="Import from image" onClick={() => nav(`/workspaces/${currentWorkspaceId}/import/image`)} />
            </div>
          )}

          {/* Library */}
          <div className="px-2 pt-2 pb-1" style={{ borderTop: '1px solid var(--ink-border-subtle)' }}>
            <SectionLabel>Library</SectionLabel>
            <Row icon={Icon.budget} label="Budget" active={pathname.startsWith('/budget')} onClick={() => nav('/budget')} />
            <Row icon={Icon.lists} label="Lists" active={pathname.startsWith('/lists') || pathname.startsWith('/shopping')} onClick={() => nav('/lists')} />
            <Row icon={Icon.echoes} label="Echoes" active={pathname.startsWith('/reminders')} onClick={() => nav('/reminders')} />
            <Row icon={Icon.huddles} label="Huddles" active={pathname.startsWith('/huddles')} onClick={() => nav('/huddles')} />
            <Row icon={Icon.friends} label="Friends" active={pathname.startsWith('/friends')} onClick={() => nav('/friends')} />
          </div>
        </div>

        {/* Account footer */}
        <div className="px-2 py-2" style={{ borderTop: '1px solid var(--ink-border-subtle)' }}>
          <Row
            icon={theme === 'light' ? Icon.moon : Icon.sun}
            label={theme === 'light' ? 'Dark mode' : 'Light mode'}
            onClick={toggleTheme}
          />
          <Row icon={Icon.settings} label="Settings" active={pathname.startsWith('/settings')} onClick={() => nav('/settings')} />
          <Row icon={Icon.help} label="Guide & help" active={pathname.startsWith('/help')} onClick={() => nav('/help')} />
          <Row
            icon={Icon.signOut}
            label="Sign out"
            danger
            onClick={() => { logout().then(() => router.push('/login')); onClose(); }}
          />
        </div>
      </aside>
    </>
  );
}
