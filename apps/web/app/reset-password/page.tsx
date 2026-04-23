'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError('Reset link is missing its token. Request a new one.');
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, newPassword },
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--ink-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink-text)' }}>Set a new password</h1>
        </div>

        {done ? (
          <div
            className="rounded-xl p-6 space-y-3 text-sm text-center"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text)' }}
          >
            <p>Password updated. Redirecting to sign in…</p>
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
              <label className="z-label block mb-1">New password</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="z-input"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div>
              <label className="z-label block mb-1">Confirm new password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="z-input"
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !token}
              className="z-btn z-btn-primary w-full py-2.5"
            >
              {submitting ? 'Updating…' : 'Update password'}
            </button>
            <p className="text-center z-caption">
              <Link href="/login" className="underline" style={{ color: 'var(--ink-accent)' }}>Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--ink-bg)' }} />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
