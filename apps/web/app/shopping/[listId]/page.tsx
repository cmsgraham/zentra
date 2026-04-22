'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';

export default function ShoppingListDetailRedirectPage() {
  const router = useRouter();
  const { listId } = useParams() as { listId: string };

  useEffect(() => {
    if (listId) router.replace(`/lists/${listId}`);
  }, [router, listId]);

  return (
    <AuthShell>
      <div className="max-w-2xl mx-auto p-6 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
        Redirecting to List...
      </div>
    </AuthShell>
  );
}
