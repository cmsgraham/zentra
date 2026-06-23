'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

/**
 * Danger Zone — permanent account + data deletion.
 *
 * Two-step flow:
 *   1. Click "Delete account" — reveals a confirmation form.
 *   2. User must type "DELETE" AND enter their password (if they have one).
 * On success, the server cascades deletion of all owned data and clears
 * auth cookies. We then push to /login.
 */
export default function DangerZoneSection() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setError('Please type DELETE to confirm.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/auth/me', {
        method: 'DELETE',
        body: { password: password || undefined, confirmation },
      });
      try { await logout(); } catch {}
      router.replace('/login?deleted=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-2xl p-5 mt-6"
      style={{
        background: 'var(--ink-surface)',
        border: '1px solid color-mix(in srgb, var(--ink-blocked) 35%, var(--ink-border))',
      }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink-blocked)' }}>
        Danger zone
      </h2>
      <p className="text-sm mt-1" style={{ color: 'var(--ink-text-muted)' }}>
        Permanently delete your account and all associated data.
      </p>

      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: 'transparent',
            border: '1px solid var(--ink-blocked)',
            color: 'var(--ink-blocked)',
          }}
        >
          Delete account
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <div
            className="p-3 rounded-lg text-sm"
            style={{
              background: 'color-mix(in srgb, var(--ink-blocked) 6%, transparent)',
              color: 'var(--ink-text)',
              border: '1px solid color-mix(in srgb, var(--ink-blocked) 30%, transparent)',
            }}
          >
            <strong>This cannot be undone.</strong> All your workspaces, tasks, lists,
            focus sessions, reminders, shared items, and account history will be
            deleted immediately{user?.email ? ` for ${user.email}` : ''}.
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-text-muted)' }}>
              Password (leave blank if you sign in only with Google)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-text-muted)' }}>
              Type <span style={{ fontFamily: 'monospace', color: 'var(--ink-blocked)' }}>DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="DELETE"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}
            />
          </div>

          {error && (
            <div className="text-sm" style={{ color: 'var(--ink-blocked)' }}>{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={submitting || confirmation.trim().toUpperCase() !== 'DELETE'}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--ink-blocked)' }}
            >
              {submitting ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button
              onClick={() => {
                setExpanded(false);
                setPassword('');
                setConfirmation('');
                setError(null);
              }}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm"
              style={{
                background: 'transparent',
                border: '1px solid var(--ink-border)',
                color: 'var(--ink-text-muted)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
