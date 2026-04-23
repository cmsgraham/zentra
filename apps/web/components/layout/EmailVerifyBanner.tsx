'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';

const DISMISS_KEY = 'zentra_email_verify_banner_dismissed';

/**
 * Slim banner shown above all authenticated views when the user's email is
 * not yet verified. Soft-enforces verification: visible reminder + one-click
 * link to /verify-email, plus a session-only dismiss.
 */
export default function EmailVerifyBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (!user) return null;
  if (user.emailVerified) return null;
  if (dismissed) return null;

  return (
    <div
      className="px-4 py-2 flex items-center gap-3 text-xs"
      style={{
        background: 'color-mix(in srgb, var(--ink-warning, #b8860b) 10%, transparent)',
        borderBottom: '1px solid var(--ink-border-subtle)',
        color: 'var(--ink-text)',
      }}
    >
      <span>
        <strong>Verify your email</strong> — some features will be limited until you confirm <strong>{user.email}</strong>.
      </span>
      <Link href="/verify-email" className="underline ml-auto" style={{ color: 'var(--ink-accent)' }}>
        Verify now
      </Link>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
        }}
        className="opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
