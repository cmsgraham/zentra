'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  auth_provider: string;
  email_verified_at: string | null;
  totp_enabled: boolean;
  created_at: string;
  last_seen_at: string | null;
  workspaces_owned: number;
}

export default function UsersPage() {
  const [items, setItems] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ items: User[] }>(
        `/zentra-ops/users?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}&limit=100`,
      );
      setItems(r.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function action(id: string, kind: 'suspend' | 'unsuspend' | 'delete' | 'promote' | 'demote') {
    if (kind === 'delete' && !confirm('Permanently delete this user and all their data? This cannot be undone.')) return;
    if (kind === 'suspend' && !confirm('Suspend this user? They will be signed out and unable to log in.')) return;
    setBusy(id);
    try {
      if (kind === 'suspend') await api(`/zentra-ops/users/${id}/suspend`, { method: 'POST', body: {} });
      if (kind === 'unsuspend') await api(`/zentra-ops/users/${id}/unsuspend`, { method: 'POST', body: {} });
      if (kind === 'delete') await api(`/zentra-ops/users/${id}`, { method: 'DELETE' });
      if (kind === 'promote') await api(`/zentra-ops/users/${id}/role`, { method: 'POST', body: { role: 'admin' } });
      if (kind === 'demote') await api(`/zentra-ops/users/${id}/role`, { method: 'POST', body: { role: 'user' } });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-text-muted)' }}>
          Email, status & metadata only. User content (intentions, echoes, notes) is never visible.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search email or name…"
          className="flex-1 px-4 py-2 rounded-lg text-sm outline-none"
          style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--ink-accent)' }}
        >
          Search
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--ink-surface)', boxShadow: '0 0 0 1px var(--ink-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3">Spaces</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>No users</td></tr>}
            {items.map((u) => (
              <tr key={u.id} style={{ borderTop: '1px solid var(--ink-border)' }}>
                <td className="px-4 py-3">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded" style={{
                    background: u.role === 'admin' ? 'var(--ink-accent)' : 'var(--ink-subtle)',
                    color: u.role === 'admin' ? 'white' : 'var(--ink-text)',
                  }}>{u.role}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs" style={{ color: u.status === 'suspended' ? 'var(--ink-blocked)' : undefined }}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">{u.auth_provider}{u.totp_enabled ? ' · 2FA' : ''}</td>
                <td className="px-4 py-3 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-xs">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 text-xs">{u.workspaces_owned}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    {u.role === 'user' ? (
                      <button onClick={() => action(u.id, 'promote')} disabled={busy === u.id}
                        className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--ink-border)' }}>
                        Promote
                      </button>
                    ) : (
                      <button onClick={() => action(u.id, 'demote')} disabled={busy === u.id}
                        className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--ink-border)' }}>
                        Demote
                      </button>
                    )}
                    {u.status === 'active' ? (
                      <button onClick={() => action(u.id, 'suspend')} disabled={busy === u.id}
                        className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-blocked)' }}>
                        Suspend
                      </button>
                    ) : (
                      <button onClick={() => action(u.id, 'unsuspend')} disabled={busy === u.id}
                        className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--ink-border)' }}>
                        Unsuspend
                      </button>
                    )}
                    <button onClick={() => action(u.id, 'delete')} disabled={busy === u.id}
                      className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--ink-blocked)', color: 'var(--ink-blocked)' }}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
