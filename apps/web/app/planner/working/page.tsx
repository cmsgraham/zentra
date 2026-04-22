'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useRouter } from 'next/navigation';
import WorkingMode from '@/components/planner/WorkingMode';

export default function WorkingModePage() {
  const { user, loading, loadUser } = useAuth();
  const { init: initTheme } = useTheme();
  const router = useRouter();

  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { initTheme(); }, [initTheme]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="wm-container">
        <div className="wm-content">
          <p className="wm-loading">Loading…</p>
        </div>
      </div>
    );
  }

  return <WorkingMode />;
}
