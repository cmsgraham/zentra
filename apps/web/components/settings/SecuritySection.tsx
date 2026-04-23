'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

/**
 * Security section for the Settings page:
 *   - Email verification status (banner + resend link)
 *   - Change password (or set one if Google-only account)
 *   - 2FA enable / disable + recovery codes
 */
export default function SecuritySection() {
  const { user, refreshUser } = useAuth();
  if (!user) return null;

  return (
    <div className="rounded-xl p-4 sm:p-6" style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}>
      <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--ink-text)' }}>Security</h2>
      <div className="space-y-6">
        <EmailVerifyBlock verified={!!user.emailVerified} />
        <PasswordBlock hasPassword={user.hasPassword !== false} onChanged={refreshUser} />
        <TwofaBlock enabled={!!user.twoFactorEnabled} onChanged={refreshUser} />
        <ConnectedAccountsBlock googleLinked={!!user.googleLinked} email={user.email} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Email verification                                                  */
/* ------------------------------------------------------------------ */
function EmailVerifyBlock({ verified }: { verified: boolean }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (verified) {
    return (
      <Row label="Email" value={<span style={{ color: 'var(--ink-accent)' }}>✓ Verified</span>} />
    );
  }

  async function resend() {
    setError(''); setBusy(true);
    try {
      await api('/auth/email/verify/request', { method: 'POST' });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Row
        label="Email"
        value={<span style={{ color: 'var(--ink-blocked)' }}>Not verified</span>}
      />
      <div className="mt-2 flex flex-wrap gap-2 items-center">
        <a href="/verify-email" className="text-xs underline" style={{ color: 'var(--ink-accent)' }}>
          Enter verification code →
        </a>
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="text-xs underline"
          style={{ color: 'var(--ink-text-muted)' }}
        >
          {busy ? 'Sending…' : sent ? 'Sent — check inbox' : 'Resend code'}
        </button>
      </div>
      {error && <p className="text-xs mt-1" style={{ color: 'var(--ink-blocked)' }}>{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Change password                                                     */
/* ------------------------------------------------------------------ */
function PasswordBlock({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!hasPassword) {
    return (
      <Row
        label="Password"
        value={
          <span style={{ color: 'var(--ink-text-muted)' }}>
            Not set — use the <a href="/forgot" className="underline" style={{ color: 'var(--ink-accent)' }}>password reset</a> flow to add one.
          </span>
        }
      />
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setDone(false);
    if (next.length < 8) return setError('Password must be at least 8 characters.');
    if (next !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await api('/auth/password/change', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      setTimeout(() => { setOpen(false); setDone(false); }, 1200);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Row
        label="Password"
        value={
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs underline"
            style={{ color: 'var(--ink-accent)' }}
          >
            {open ? 'Cancel' : 'Change password'}
          </button>
        }
      />
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          {error && <div className="text-xs px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--ink-blocked) 8%, transparent)', color: 'var(--ink-blocked)' }}>{error}</div>}
          {done && <div className="text-xs" style={{ color: 'var(--ink-accent)' }}>Password updated.</div>}
          <input type="password" required placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className="z-input" autoComplete="current-password" />
          <input type="password" required minLength={8} placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} className="z-input" autoComplete="new-password" />
          <input type="password" required minLength={8} placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="z-input" autoComplete="new-password" />
          <button type="submit" disabled={busy} className="z-btn z-btn-primary py-2 text-sm">{busy ? 'Saving…' : 'Update password'}</button>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TOTP 2FA                                                            */
/* ------------------------------------------------------------------ */
function TwofaBlock({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const [setupData, setSetupData] = useState<{ qrDataUrl: string; otpauthUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);

  async function startSetup() {
    setError(''); setBusy(true); setRecoveryCodes(null);
    try {
      const data = await api<{ otpauthUrl: string; qrDataUrl: string; secret: string }>(
        '/auth/2fa/setup', { method: 'POST' },
      );
      setSetupData(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start 2FA setup');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api<{ enabled: boolean; recoveryCodes: string[] }>(
        '/auth/2fa/enable', { method: 'POST', body: { code: code.trim() } },
      );
      setRecoveryCodes(r.recoveryCodes);
      setSetupData(null);
      setCode('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { password: disablePassword } });
      setDisableOpen(false);
      setDisablePassword('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disable 2FA');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Row
        label="Two-factor (2FA)"
        value={
          enabled
            ? <span style={{ color: 'var(--ink-accent)' }}>✓ Enabled</span>
            : <span style={{ color: 'var(--ink-text-muted)' }}>Off</span>
        }
      />

      {/* Recovery codes (one-time display after enable) */}
      {recoveryCodes && (
        <div className="mt-3 p-3 rounded-lg" style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-accent)' }}>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-text)' }}>
            Save these recovery codes somewhere safe. Each can be used once if you lose your authenticator.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs" style={{ color: 'var(--ink-text)' }}>
            {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}
            className="mt-2 text-xs underline"
            style={{ color: 'var(--ink-accent)' }}
          >
            Copy all
          </button>
          <button
            type="button"
            onClick={() => setRecoveryCodes(null)}
            className="mt-2 ml-3 text-xs underline"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            I&apos;ve saved them
          </button>
        </div>
      )}

      {/* Enable flow */}
      {!enabled && !setupData && !recoveryCodes && (
        <button
          type="button"
          onClick={startSetup}
          disabled={busy}
          className="mt-2 text-xs underline"
          style={{ color: 'var(--ink-accent)' }}
        >
          {busy ? 'Loading…' : 'Set up 2FA'}
        </button>
      )}

      {!enabled && setupData && (
        <form onSubmit={confirmEnable} className="mt-3 space-y-2">
          <p className="text-xs" style={{ color: 'var(--ink-text-secondary)' }}>
            Scan this code with Google Authenticator, Authy, or 1Password — then enter the 6-digit code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setupData.qrDataUrl} alt="2FA QR code" width={200} height={200} className="rounded bg-white p-2" />
          <details className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            <summary className="cursor-pointer">Can&apos;t scan? Enter manually</summary>
            <code className="block mt-1 break-all">{setupData.secret}</code>
          </details>
          <input
            type="text"
            required
            pattern="\d{6}"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="z-input tracking-widest text-center"
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || code.length !== 6} className="z-btn z-btn-primary py-2 text-sm">
              {busy ? 'Verifying…' : 'Enable 2FA'}
            </button>
            <button type="button" onClick={() => { setSetupData(null); setCode(''); setError(''); }} className="text-xs underline" style={{ color: 'var(--ink-text-muted)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Disable flow */}
      {enabled && (
        <div className="mt-2">
          {!disableOpen ? (
            <button type="button" onClick={() => setDisableOpen(true)} className="text-xs underline" style={{ color: 'var(--ink-text-muted)' }}>
              Disable 2FA
            </button>
          ) : (
            <form onSubmit={disable} className="mt-2 space-y-2">
              <p className="text-xs" style={{ color: 'var(--ink-text-secondary)' }}>Enter your current password to disable 2FA.</p>
              <input
                type="password"
                required
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="z-input"
                autoComplete="current-password"
                placeholder="Current password"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="z-btn py-2 text-sm" style={{ background: 'var(--ink-blocked)', color: 'white' }}>
                  {busy ? 'Disabling…' : 'Disable 2FA'}
                </button>
                <button type="button" onClick={() => { setDisableOpen(false); setDisablePassword(''); setError(''); }} className="text-xs underline" style={{ color: 'var(--ink-text-muted)' }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && <p className="text-xs mt-2" style={{ color: 'var(--ink-blocked)' }}>{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Connected accounts (read-only display for now)                      */
/* ------------------------------------------------------------------ */
function ConnectedAccountsBlock({ googleLinked, email }: { googleLinked: boolean; email: string }) {
  return (
    <Row
      label="Google sign-in"
      value={
        googleLinked
          ? <span style={{ color: 'var(--ink-accent)' }}>✓ Linked ({email})</span>
          : (
            <a href="/api/auth/google" className="text-xs underline" style={{ color: 'var(--ink-accent)' }}>
              Link Google account
            </a>
          )
      }
    />
  );
}

/* ------------------------------------------------------------------ */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm" style={{ color: 'var(--ink-text)' }}>{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
