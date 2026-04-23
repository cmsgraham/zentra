'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();
  const { user, loading, loadUser } = useAuth();

  useEffect(() => { loadUser(); }, [loadUser]);

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/today');
    else router.replace('/welcome');
  }, [user, loading, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8">
      <div className="animate-pulse text-[var(--ink-text-muted)] text-lg">Loading…</div>
      <nav
        aria-label="Site"
        className="text-xs text-[var(--ink-text-muted)] flex gap-3 items-center"
      >
        <Link href="/welcome" className="underline">About Zentra</Link>
        <span aria-hidden>·</span>
        <Link href="/legal/privacy" className="underline">Privacy Policy</Link>
        <span aria-hidden>·</span>
        <Link href="/legal/terms" className="underline">Terms of Service</Link>
      </nav>
    </div>
  );
}
