'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api-client';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, refreshUser, loadUser, loading } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user && !loading) loadUser();
  }, [user, loading, loadUser]);

  useEffect(() => {
    if (user?.emailVerified) setDone(true);
  }, [user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('/auth/email/verify/confirm', { method: 'POST', body: { code: code.trim() } });
      await refreshUser();
      setDone(true);
      setTimeout(() => router.push('/today'), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    setResending(true);
    try {
      await api('/auth/email/verify/request', { method: 'POST' });
      setResentAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend');
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--ink-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink-text)' }}>Verify your email</h1>
          {user?.email && (
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
              We sent a 6-digit code to <strong>{user.email}</strong>.
            </p>
          )}
        </div>

        {done ? (
          <div
            className="rounded-xl p-6 space-y-3 text-sm text-center"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text)' }}
          >
            <p>Email verified. Welcome to Zentra.</p>
            <Link href="/today" className="block underline" style={{ color: 'var(--ink-accent)' }}>Go to Today</Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl p-6 space-y-4"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', boxShadow: 'var(--ink-shadow-md)' }}
          >
            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--ink-blocked) 8%, transparent)', color: 'var(--ink-blocked)' }}>
                {error}
              </div>
            )}
            <div>
              <label className="z-label block mb-1">Verification code</label>
              <input
                type="text"
                required
                pattern="\d{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="z-input tracking-[0.5em] text-center text-lg"
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={submitting || code.length !== 6}
              className="z-btn z-btn-primary w-full py-2.5"
            >
              {submitting ? 'Verifying…' : 'Verify email'}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="w-full text-xs underline"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              {resending ? 'Sending…' : resentAt ? 'Code resent — check your inbox' : 'Resend code'}
            </button>
            <p className="text-center z-caption">
              <Link href="/today" className="underline" style={{ color: 'var(--ink-text-muted)' }}>Skip for now</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
