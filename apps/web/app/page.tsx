'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();
  const { user, loading, loadUser } = useAuth();

  useEffect(() => { loadUser(); }, [loadUser]);

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/today');
    else router.replace('/login');
  }, [user, loading, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse text-[var(--ink-text-muted)] text-lg">Loading…</div>
    </div>
  );
}
