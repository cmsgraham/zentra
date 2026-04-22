'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { ApiError } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { theme, init: initTheme } = useTheme();

  useEffect(() => { initTheme(); }, [initTheme]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      router.push('/workspaces');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--ink-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src={theme === 'dark' ? '/zentra_logo_blanco.png' : '/zentra_logo_azul.png'}
            alt="Zentra"
            className="h-20 mx-auto"
          />
          <p className="z-body mt-2" style={{ color: 'var(--ink-text-secondary)' }}>Sign in to your space</p>
        </div>
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
            />
          </div>
          <div>
            <label className="z-label block mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="z-input"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="z-btn z-btn-primary w-full py-2.5"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center z-caption">
            No account?{' '}
            <Link href="/signup" className="underline" style={{ color: 'var(--ink-accent)' }}>Sign up</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
