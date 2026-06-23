'use client';

/**
 * Inline prompt that nudges signed-in users to add a passkey on this device.
 *
 * Behaviour:
 *  - Shows only when the browser supports WebAuthn AND the device has a
 *    platform authenticator (Face ID / Touch ID / Windows Hello).
 *  - Hidden if the user already has at least one passkey, or already
 *    dismissed the prompt on this device, or has no logged-in session.
 *  - Dismissal is per-device (localStorage), so a user signing in elsewhere
 *    still sees the prompt.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  passkeysSupported,
  platformBiometricAvailable,
  registerPasskey,
  listPasskeys,
  hasDismissedPasskeyPrompt,
  dismissPasskeyPrompt,
} from '@/lib/passkeys';

export default function PasskeyEnrollPrompt() {
  const { user } = useAuth();
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      if (hasDismissedPasskeyPrompt()) return;
      if (!passkeysSupported()) return;
      const platform = await platformBiometricAvailable();
      if (!platform) return;
      // Only prompt when the user has no existing passkey on file.
      try {
        const list = await listPasskeys();
        if (cancelled) return;
        if (list.length === 0) setEligible(true);
      } catch {
        /* if /passkeys 401s the api-client refreshes; otherwise just skip */
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!eligible || done) return null;

  async function enable() {
    setError('');
    setBusy(true);
    try {
      await registerPasskey('This device');
      setDone(true);
      dismissPasskeyPrompt();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up passkey');
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    dismissPasskeyPrompt();
    setEligible(false);
  }

  return (
    <div
      className="mx-3 my-2 rounded-lg px-3 py-2 text-sm flex items-center gap-3"
      style={{
        background: 'color-mix(in srgb, var(--ink-accent) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--ink-accent) 25%, transparent)',
        color: 'var(--ink-text)',
      }}
      role="region"
      aria-label="Set up Face ID for faster sign-in"
    >
      <span aria-hidden className="text-lg">🔐</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium">Skip the password next time</div>
        <div className="text-xs" style={{ color: 'var(--ink-text-secondary)' }}>
          {error || 'Use Face ID, Touch ID or Windows Hello to sign in on this device.'}
        </div>
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        className="z-btn z-btn-primary text-xs px-3 py-1.5"
      >
        {busy ? 'Setting up…' : 'Enable'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="text-xs underline"
        style={{ color: 'var(--ink-text-muted)' }}
        aria-label="Dismiss"
      >
        Not now
      </button>
    </div>
  );
}
