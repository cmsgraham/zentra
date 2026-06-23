'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';
import { useFocusStore } from '@/lib/useFocusStore';
import FocusOverlay from '@/components/planner/FocusOverlay';
import MobileTopBar from '@/components/mobile/MobileTopBar';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import MobileDrawer from '@/components/mobile/MobileDrawer';
import EmailVerifyBanner from '@/components/layout/EmailVerifyBanner';
import OfflineBanner from '@/components/layout/OfflineBanner';
import PasskeyEnrollPrompt from '@/components/auth/PasskeyEnrollPrompt';
import ProductTour from '@/components/tour/ProductTour';
import TourLegend from '@/components/tour/TourLegend';
import { useTour } from '@/lib/useTour';

interface Workspace {
  id: string;
  name: string;
}

function getMobileTitle(pathname: string, workspaceName?: string): string {
  if (pathname === '/today') return 'Flow';
  if (pathname === '/reflect') return 'Reflect';
  if (pathname === '/onboarding') return 'Getting started';
  if (pathname.startsWith('/lists/') && pathname !== '/lists') return 'List';
  if (pathname === '/lists') return 'Lists';
  if (pathname.startsWith('/budget/') && pathname !== '/budget') return 'Budget Space';
  if (pathname === '/budget') return 'Budget';
  if (pathname.startsWith('/shopping/import')) return 'AI Import';
  if (pathname.startsWith('/shopping/insights')) return 'Insights';
  if (pathname.startsWith('/shopping/') && pathname !== '/shopping') return 'List';
  if (pathname === '/shopping') return 'Lists';
  if (pathname === '/friends') return 'Friends';
  if (pathname === '/reminders') return 'Echoes';
  if (pathname === '/huddles') return 'Huddles';
  if (pathname === '/huddles/new') return 'Start a Huddle';
  if (pathname === '/huddles/templates') return 'Huddle templates';
  if (pathname.startsWith('/huddles/')) return 'Huddle';
  if (pathname.includes('/planner')) return workspaceName || 'Canvas';
  if (pathname.includes('/blocked')) return 'Waiting on…';
  if (pathname.includes('/archive')) return 'Archive';
  if (pathname.includes('/import/text')) return 'Text Import';
  if (pathname.includes('/import/image')) return 'Image Import';
  if (pathname === '/workspaces') return 'Studio';
  if (pathname === '/workspaces/all') return 'All spaces';
  if (pathname.startsWith('/workspaces/')) return workspaceName || 'Space';
  return 'zentra';
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, loadUser, logout } = useAuth();
  const { theme, toggle: toggleTheme, init: initTheme } = useTheme();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const currentWorkspaceId = params.workspaceId as string | undefined;
  const hydrateSession = useFocusStore((s) => s.hydrate);
  const subscribeFocusSync = useFocusStore((s) => s.subscribeSync);
  const autoStartTour = useTour((s) => s.autoStart);

  useEffect(() => { if (user) hydrateSession(); }, [user, hydrateSession]);
  useEffect(() => subscribeFocusSync(), [subscribeFocusSync]);
  // Kick off the product tour for first-time users (no-op if already done).
  useEffect(() => { if (user) autoStartTour(); }, [user, autoStartTour]);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { initTheme(); }, [initTheme]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      api<{ items: Workspace[] }>('/workspaces')
        .then((d) =>
          setWorkspaces(
            [...d.items].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
            ),
          ),
        )
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setWsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse" style={{ color: 'var(--ink-text-muted)' }}>Loading…</div>
      </div>
    );
  }

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
  const isOnAllSpaces = pathname === '/workspaces/all' || pathname.startsWith('/workspaces/all/');
  const isOnWorkspacePage = pathname.startsWith('/workspaces/');

  // ── MOBILE LAYOUT ──
  if (isMobile) {
    const title = getMobileTitle(pathname, currentWorkspace?.name);
    const logoSrc = title === 'zentra'
      ? (theme === 'dark' ? '/zentra_nombre_blanco.png' : '/zentra_nombre_azul.png')
      : undefined;
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--ink-bg)' }}>
        <MobileTopBar title={title} onMenuPress={() => setDrawerOpen(true)} logoSrc={logoSrc} />
        <OfflineBanner />
        <EmailVerifyBanner />
        <PasskeyEnrollPrompt />
        <main className="flex-1 overflow-y-auto" style={{ paddingBottom: '64px' }}>
          {children}
        </main>
        <MobileBottomNav onMorePress={() => setDrawerOpen(true)} />
        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} workspaces={workspaces} />
        <FocusOverlay />
        <ProductTour />
        <TourLegend />
      </div>
    );
  }

  // ── DESKTOP LAYOUT ──
  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="flex items-center justify-between px-5 h-[52px] shrink-0"
        style={{ background: 'var(--ink-surface)', borderBottom: '1px solid var(--ink-border-subtle)' }}
      >
        <div className="flex items-center gap-5">
          <a
            href="/today"
            data-tour-label="Zentra — back to Flow"
            className="flex items-center opacity-90 hover:opacity-100 transition-opacity"
          >
            <img
              src={theme === 'dark' ? '/zentra_nombre_blanco.png' : '/zentra_nombre_azul.png'}
              alt="Zentra"
              className="h-5"
            />
          </a>

          {isOnWorkspacePage && (
            <>
              <span style={{ color: 'var(--ink-border)', fontSize: '1rem', fontWeight: 200 }}>/</span>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setWsOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[13px] font-medium transition-all"
                  style={{ color: 'var(--ink-text-secondary)' }}
                >
                  <span className="max-w-[180px] truncate">{isOnAllSpaces ? 'All spaces' : (currentWorkspace?.name ?? 'Space')}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                    <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {wsOpen && (
                  <div
                    className="absolute left-0 top-full mt-1.5 w-52 py-1 z-50 max-h-64 overflow-y-auto z-overlay z-animate-in"
                  >
                    {workspaces.length > 1 && (
                      <>
                        <button
                          onClick={() => { setWsOpen(false); router.push('/workspaces/all'); }}
                          className="w-full text-left px-3 py-1.5 text-[13px] transition-colors rounded-md mx-1"
                          style={{
                            width: 'calc(100% - 8px)',
                            background: isOnAllSpaces ? 'var(--ink-accent-light)' : 'transparent',
                            fontWeight: isOnAllSpaces ? 550 : 400,
                            color: isOnAllSpaces ? 'var(--ink-accent)' : 'var(--ink-text)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                          onMouseEnter={(e) => { if (!isOnAllSpaces) e.currentTarget.style.background = 'var(--ink-surface-hover)'; }}
                          onMouseLeave={(e) => { if (!isOnAllSpaces) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}>
                            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                          </svg>
                          All spaces
                        </button>
                        <div className="my-1 mx-2" style={{ height: '1px', background: 'var(--ink-border-subtle)' }} />
                      </>
                    )}
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => { setWsOpen(false); router.push(`/workspaces/${ws.id}`); }}
                        className="w-full text-left px-3 py-1.5 text-[13px] transition-colors rounded-md mx-1"
                        style={{
                          width: 'calc(100% - 8px)',
                          background: ws.id === currentWorkspaceId ? 'var(--ink-accent-light)' : 'transparent',
                          fontWeight: ws.id === currentWorkspaceId ? 550 : 400,
                          color: ws.id === currentWorkspaceId ? 'var(--ink-accent)' : 'var(--ink-text)',
                        }}
                        onMouseEnter={(e) => { if (ws.id !== currentWorkspaceId) e.currentTarget.style.background = 'var(--ink-surface-hover)'; }}
                        onMouseLeave={(e) => { if (ws.id !== currentWorkspaceId) e.currentTarget.style.background = 'transparent'; }}
                      >
                        {ws.name}
                      </button>
                    ))}
                    <div className="my-1 mx-2" style={{ height: '1px', background: 'var(--ink-border-subtle)' }} />
                    <button
                      onClick={() => { setWsOpen(false); router.push('/workspaces'); }}
                      className="w-full text-left px-3 py-1.5 text-[13px] transition-colors rounded-md mx-1"
                      style={{ width: 'calc(100% - 8px)', color: 'var(--ink-text-muted)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ink-surface-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      Manage spaces…
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => router.push('/today')}
            data-tour="today"
            data-tour-label="Flow — your daily focus view"
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname === '/today' ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem', fontWeight: pathname === '/today' ? 600 : 400 }}
          >
            Flow
          </button>
          {/* Studio is always available, even from Planner views, so users
              never lose their way back to the board. */}
          <button
            onClick={() => router.push('/workspaces')}
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname.startsWith('/workspaces') ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem' }}
          >
            Studio
          </button>
          <button
            onClick={() => router.push('/budget')}
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname.startsWith('/budget') ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem' }}
          >
            Budget
          </button>
          <button
            onClick={() => router.push('/lists')}
            data-tour="lists"
            data-tour-label="Lists — shopping & checklists"
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname.startsWith('/lists') || pathname.startsWith('/shopping') ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem' }}
          >
            Lists
          </button>
          <button
            onClick={() => router.push('/friends')}
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname.startsWith('/friends') ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem' }}
          >
            Friends
          </button>
          <button
            onClick={() => router.push('/huddles')}
            data-tour="huddles"
            data-tour-label="Huddles — structured conversations that move work forward"
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname.startsWith('/huddles') ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem' }}
          >
            Huddles
          </button>
          <button
            onClick={() => router.push('/reminders')}
            data-tour="echoes"
            data-tour-label="Echoes — gentle reminders"
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: pathname.startsWith('/reminders') ? 'var(--ink-accent)' : 'var(--ink-text-muted)', fontSize: '0.8125rem' }}
          >
            Echoes
          </button>
          <div className="w-px h-4 mx-1.5" style={{ background: 'var(--ink-border-subtle)' }} />
          <button
            onClick={toggleTheme}
            className="z-btn-ghost z-btn-icon rounded-md"
            style={{ color: 'var(--ink-text-muted)', width: '30px', height: '30px' }}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
          </button>
          <button
            onClick={() => router.push('/help')}
            data-tour="help"
            data-tour-label="Help — guide, FAQ & replay tour"
            className="z-btn-ghost z-btn-icon rounded-md"
            style={{ color: pathname === '/help' ? 'var(--ink-accent)' : 'var(--ink-text-muted)', width: '30px', height: '30px' }}
            title="Guide & help"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/>
              <line x1="12" y1="17" x2="12" y2="17.01"/>
            </svg>
          </button>
          <button
            onClick={() => router.push('/settings')}
            data-tour="profile"
            data-tour-label="Profile & Settings — preferences and tour replay"
            className="z-btn-ghost z-btn-icon rounded-md"
            style={{ color: 'var(--ink-text-muted)', width: '30px', height: '30px' }}
            title="Settings"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <div className="w-px h-4 mx-1.5" style={{ background: 'var(--ink-border-subtle)' }} />
          <span className="text-[13px] font-medium mr-1" style={{ color: 'var(--ink-text-muted)' }}>{user.name}</span>
          <button
            onClick={() => logout().then(() => router.push('/login'))}
            className="z-btn-ghost z-btn-sm rounded-md"
            style={{ color: 'var(--ink-text-muted)', fontSize: '0.75rem' }}
          >
            Sign out
          </button>
        </div>
      </header>
      <OfflineBanner />
      <EmailVerifyBanner />
      <PasskeyEnrollPrompt />
      <main className="flex-1">{children}</main>
      <FocusOverlay />
      <ProductTour />
      <TourLegend />
    </div>
  );
}
