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

          <a
            href="/api/auth/google"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'var(--ink-bg)',
              color: 'var(--ink-text)',
              border: '1px solid var(--ink-border)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.345 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.655 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </a>

          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            <div className="flex-1 h-px" style={{ background: 'var(--ink-border)' }} />
            <span>or</span>
            <div className="flex-1 h-px" style={{ background: 'var(--ink-border)' }} />
          </div>

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
