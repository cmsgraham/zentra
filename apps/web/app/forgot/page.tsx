'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('/auth/password-reset/request', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      // We always 202 server-side, so any error is unusual.
      setError(err instanceof ApiError ? err.message : 'Could not send reset email');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--ink-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink-text)' }}>Reset your password</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
            We&apos;ll email you a link to set a new one.
          </p>
        </div>

        {sent ? (
          <div
            className="rounded-xl p-6 space-y-4 text-sm"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text)' }}
          >
            <p>If an account exists for <strong>{email}</strong>, a reset link is on its way.</p>
            <p style={{ color: 'var(--ink-text-muted)' }}>The link expires in 1 hour. Check your spam folder if it doesn&apos;t arrive.</p>
            <Link href="/login" className="block text-center underline" style={{ color: 'var(--ink-accent)' }}>
              Back to sign in
            </Link>
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
              <label className="z-label block mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="z-input"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="z-btn z-btn-primary w-full py-2.5"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-center z-caption">
              Remembered it?{' '}
              <Link href="/login" className="underline" style={{ color: 'var(--ink-accent)' }}>Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
