'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';

export default function ShoppingImportRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/lists');
  }, [router]);

  return (
    <AuthShell>
      <div className="max-w-2xl mx-auto p-6 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
        Redirecting to Lists...
      </div>
    </AuthShell>
  );
}
