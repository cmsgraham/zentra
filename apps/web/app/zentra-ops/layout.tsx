'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api-client';

const SECTIONS: { href: string; label: string }[] = [
  { href: '/zentra-ops', label: 'Overview' },
  { href: '/zentra-ops/users', label: 'Users' },
  { href: '/zentra-ops/tickets', label: 'Support tickets' },
  { href: '/zentra-ops/security', label: 'Security' },
  { href: '/zentra-ops/system', label: 'System' },
  { href: '/zentra-ops/flags', label: 'Feature flags' },
  { href: '/zentra-ops/broadcasts', label: 'Broadcasts' },
  { href: '/zentra-ops/audit', label: 'Audit log' },
];

export default function ZentraOpsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loadUser, loading } = useAuth();
  const [verified, setVerified] = useState<'pending' | 'ok' | 'denied'>('pending');

  useEffect(() => {
    if (!user && !loading) loadUser();
  }, [user, loading, loadUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api('/zentra-ops/whoami');
        if (!cancelled) setVerified('ok');
      } catch {
        if (!cancelled) setVerified('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (verified === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ink-bg)' }}>
        <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>Verifying access…</p>
      </div>
    );
  }

  if (verified === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ink-bg)' }}>
        <div className="max-w-sm text-center space-y-4">
          <h1 className="text-xl font-semibold">Not found</h1>
          <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
            The page you’re looking for doesn’t exist.
          </p>
          <button
            onClick={() => router.push('/today')}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--ink-accent)' }}
          >
            Go to Today
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:flex" style={{ background: 'var(--ink-bg)' }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex w-64 shrink-0 border-r flex-col"
        style={{ borderColor: 'var(--ink-border)', background: 'var(--ink-surface)' }}
      >
        <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--ink-border)' }}>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-accent)' }}>
            Zentra Ops
          </div>
          <div className="text-xs mt-1 truncate" style={{ color: 'var(--ink-text-muted)' }}>
            {user?.email}
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {SECTIONS.map((s) => {
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                className="block px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: active ? 'var(--ink-subtle)' : 'transparent',
                  color: active ? 'var(--ink-accent)' : 'var(--ink-text)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--ink-border)' }}>
          <Link
            href="/today"
            className="block px-3 py-2 rounded-lg text-sm"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            ← Back to app
          </Link>
        </div>
      </aside>

      {/* Mobile top bar + horizontal tabs */}
      <div
        className="md:hidden sticky top-0 z-20 border-b"
        style={{ borderColor: 'var(--ink-border)', background: 'var(--ink-surface)' }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-accent)' }}>
              Zentra Ops
            </div>
            <div className="text-[11px] mt-0.5 truncate max-w-[60vw]" style={{ color: 'var(--ink-text-muted)' }}>
              {user?.email}
            </div>
          </div>
          <Link href="/today" className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            ← App
          </Link>
        </div>
        <nav className="flex gap-1 px-3 pb-2 overflow-x-auto no-scrollbar">
          {SECTIONS.map((s) => {
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
                style={{
                  background: active ? 'var(--ink-subtle)' : 'transparent',
                  color: active ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                  fontWeight: active ? 600 : 500,
                  boxShadow: active ? 'inset 0 0 0 1px var(--ink-border)' : 'none',
                }}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-6xl mx-auto px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
