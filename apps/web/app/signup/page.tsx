'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { ApiError } from '@/lib/api-client';

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState('');
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
      await signup(email, password, name);
      router.push('/workspaces');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign up failed');
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
          <p className="mt-2" style={{ color: 'var(--ink-text-muted)' }}>Create your account</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-4 shadow-sm"
          style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
        >
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" style={{ background: '#fff0f0', color: 'var(--ink-blocked)' }}>
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Display name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2"
              style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2"
              style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2"
              style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}
              placeholder="At least 8 characters"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg text-white text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ background: 'var(--ink-accent)' }}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
          <p className="text-center text-sm" style={{ color: 'var(--ink-text-muted)' }}>
            Already have an account?{' '}
            <Link href="/login" className="underline" style={{ color: 'var(--ink-accent)' }}>Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
