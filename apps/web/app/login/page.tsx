'use client';

import { useState, useEffect, Suspense, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { ApiError } from '@/lib/api-client';
import { passkeysSupported, signInWithPasskey } from '@/lib/passkeys';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, verifyTwofa, loadUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'creds' | 'twofa'>('creds');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [showPasskey, setShowPasskey] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const { theme, init: initTheme } = useTheme();

  useEffect(() => { initTheme(); }, [initTheme]);
  useEffect(() => { setShowPasskey(passkeysSupported()); }, []);

  // Discover which auth providers are configured server-side. Hides the
  // Google button in environments where GOOGLE_CLIENT_ID isn't set so users
  // don't hit a 404 on /api/auth/google.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/config', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGoogleEnabled(!!data?.googleEnabled);
      } catch {
        // Silently leave the button hidden if config can't be reached.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Detect in-app / embedded browsers that Google blocks for OAuth
  // (Gmail app, Instagram, Facebook, Line, WeChat, etc.). Google shows a
  // "400. That's an error. ... malformed" page in these webviews.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    // Common in-app browser signatures
    const patterns = [
      /FBAN|FBAV|FB_IAB|FBIOS/i,         // Facebook
      /Instagram/i,
      /Line\//i,
      /MicroMessenger/i,                  // WeChat
      /Twitter/i,
      /TikTok/i,
      /Snapchat/i,
      /LinkedInApp/i,
      /GSA\//i,                           // Google app (iOS)
      /Pinterest/i,
      /; wv\)/i,                          // Android WebView
    ];
    const isWebView = patterns.some((p) => p.test(ua));
    setInAppBrowser(isWebView);
  }, []);

  // Surface OAuth errors via ?error= query param
  useEffect(() => {
    const err = params.get('error');
    if (err === 'google_oauth_failed') setError('Google sign-in failed. Please try again.');
    else if (err === 'google_profile_failed') setError("Couldn't load your Google profile.");
    else if (err === 'google_no_email') setError('Your Google account did not return an email.');
  }, [params]);

  async function handleCreds(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.ok) {
        router.push('/today');
      } else {
        setStep('twofa');
        setCode('');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTwofa(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await verifyTwofa(code.trim());
      router.push('/today');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasskey() {
    setError('');
    setPasskeyBusy(true);
    try {
      await signInWithPasskey();
      // signInWithPasskey sets the auth cookies server-side; refresh the
      // local Zustand user state and route into the app.
      await loadUser();
      router.push('/today');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Passkey sign-in failed';
      // "Cancelled" is not really an error worth shouting about.
      if (!/cancel/i.test(msg)) setError(msg);
    } finally {
      setPasskeyBusy(false);
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
          <p className="z-body mt-2" style={{ color: 'var(--ink-text-secondary)' }}>
            {step === 'creds' ? 'Sign in to your space' : 'Two-factor authentication'}
          </p>
        </div>

        {step === 'creds' ? (
          <form
            onSubmit={handleCreds}
            className="rounded-xl p-6 space-y-4"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', boxShadow: 'var(--ink-shadow-md)' }}
          >
            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--ink-blocked) 8%, transparent)', color: 'var(--ink-blocked)' }}>
                {error}
              </div>
            )}

            {showPasskey && (
              <button
                type="button"
                onClick={handlePasskey}
                disabled={passkeyBusy}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'var(--ink-accent)',
                  color: 'var(--ink-on-accent)',
                  border: '1px solid var(--ink-accent)',
                }}
                aria-label="Sign in with a passkey, Face ID, Touch ID, or Windows Hello"
              >
                <FaceIdGlyph />
                {passkeyBusy ? 'Waiting for biometric…' : 'Sign in with Face ID / passkey'}
              </button>
            )}

            {googleEnabled && (
              <a
                href="/api/auth/google"
                onClick={(e) => {
                  if (inAppBrowser) {
                    e.preventDefault();
                    const url = 'https://usezentra.app/login';
                    try {
                      navigator.clipboard?.writeText(url);
                    } catch {}
                    setError(
                      "Google blocks sign-in inside in-app browsers. Tap the ⋯ menu and choose \"Open in Safari\" or \"Open in Chrome\". The link has been copied.",
                    );
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'var(--ink-bg)',
                  color: 'var(--ink-text)',
                  border: '1px solid var(--ink-border)',
                }}
              >
                <GoogleGlyph />
                Continue with Google
              </a>
            )}

            {googleEnabled && inAppBrowser && (
              <div
                className="text-xs px-3 py-2 rounded-lg"
                style={{
                  background: 'color-mix(in srgb, var(--ink-warn, #b45309) 8%, transparent)',
                  color: 'var(--ink-text-secondary)',
                  border: '1px solid color-mix(in srgb, var(--ink-warn, #b45309) 25%, transparent)',
                }}
              >
                It looks like you&apos;re in an in-app browser. Google sign-in is blocked
                here — please open this page in Safari or Chrome, or sign in with email below.
              </div>
            )}

            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
              <div className="flex-1 h-px" style={{ background: 'var(--ink-border-subtle)' }} />
              <span>or</span>
              <div className="flex-1 h-px" style={{ background: 'var(--ink-border-subtle)' }} />
            </div>

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
                autoComplete="current-password"
              />
            </div>
            <div className="flex justify-end">
              <Link href="/forgot" className="text-xs underline" style={{ color: 'var(--ink-text-muted)' }}>
                Forgot password?
              </Link>
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
        ) : (
          <form
            onSubmit={handleTwofa}
            className="rounded-xl p-6 space-y-4"
            style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)', boxShadow: 'var(--ink-shadow-md)' }}
          >
            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--ink-blocked) 8%, transparent)', color: 'var(--ink-blocked)' }}>
                {error}
              </div>
            )}
            <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
              Enter the 6-digit code from your authenticator app, or one of your one-time recovery codes.
            </p>
            <div>
              <label className="z-label block mb-1">Code</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="z-input tracking-widest text-center"
                placeholder="123 456"
                autoComplete="one-time-code"
                inputMode="text"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="z-btn z-btn-primary w-full py-2.5"
            >
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('creds'); setError(''); setCode(''); }}
              className="w-full text-xs underline"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              Use a different account
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          <Link href="/legal/terms" className="underline">Terms</Link>
          {' · '}
          <Link href="/legal/privacy" className="underline">Privacy</Link>
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.345 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.655 3.58 9 3.58z"/>
    </svg>
  );
}

function FaceIdGlyph() {
  // Stylised Face-ID-style frame; works for any biometric (Touch ID, Hello, etc.)
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8V5a2 2 0 0 1 2-2h3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M9 9v2" />
      <path d="M15 9v2" />
      <path d="M12 8v4l-1 1" />
      <path d="M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5" />
    </svg>
  );
}
