'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

interface Friend {
  friendshipId: string;
  id: string;
  name: string;
  email: string;
  since: string;
}

interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromEmail: string;
  createdAt: string;
}

interface SentRequest {
  id: string;
  toId: string;
  toName: string;
  toEmail: string;
  createdAt: string;
}

interface SharedTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  permission: string;
  sharedAt: string;
  sharedByName: string;
  workspaceName: string;
}

export default function FriendsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [sent, setSent] = useState<SentRequest[]>([]);
  const [sharedTasks, setSharedTasks] = useState<SharedTask[]>([]);

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'friends' | 'requests' | 'shared'>('friends');

  async function load() {
    const [f, r, s, st] = await Promise.all([
      api<{ items: Friend[] }>('/friends'),
      api<{ items: FriendRequest[] }>('/friends/requests'),
      api<{ items: SentRequest[] }>('/friends/sent'),
      api<{ items: SharedTask[] }>('/friends/shared-tasks'),
    ]);
    setFriends(f.items);
    setRequests(r.items);
    setSent(s.items);
    setSharedTasks(st.items);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function sendRequest(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setMessage('');
    try {
      const res = await api<{ message: string }>('/friends/request', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setMessage(res.message);
      setEmail('');
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Failed to send request');
    }
    setSending(false);
  }

  async function respond(friendshipId: string, action: 'accept' | 'reject') {
    await api(`/friends/${friendshipId}/respond`, {
      method: 'POST',
      body: { action },
    });
    await load();
  }

  async function removeFriend(friendshipId: string) {
    await api(`/friends/${friendshipId}`, { method: 'DELETE' });
    await load();
  }

  const statusColor = (s: string) => {
    if (s === 'done') return 'var(--ink-done)';
    if (s === 'in_progress') return 'var(--ink-in-progress)';
    if (s === 'blocked') return 'var(--ink-blocked)';
    return 'var(--ink-pending)';
  };

  return (
    <AuthShell>
      <div className="max-w-2xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Friends</h1>
          <button
            onClick={() => router.push('/workspaces')}
            className="text-sm px-3 py-1 rounded-lg transition-colors"
            style={{ color: 'var(--ink-text-muted)', border: '1px solid var(--ink-border)' }}
          >
            Back
          </button>
        </div>

        {/* Add friend */}
        <form onSubmit={sendRequest} className="flex gap-2 mb-6">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Friend's email address"
            type="email"
            required
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)', color: 'var(--ink-text)' }}
          />
          <button
            type="submit"
            disabled={sending}
            className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)' }}
          >
            {sending ? 'Sending...' : 'Add Friend'}
          </button>
        </form>
        {message && (
          <p className="text-sm mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-muted)' }}>
            {message}
          </p>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: 'var(--ink-subtle)' }}>
          {[
            { key: 'friends' as const, label: `Friends (${friends.length})` },
            { key: 'requests' as const, label: `Requests (${requests.length})` },
            { key: 'shared' as const, label: `Shared (${sharedTasks.length})` },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 text-sm py-1.5 rounded-md transition-colors"
              style={{
                background: tab === t.key ? 'var(--ink-surface)' : 'transparent',
                color: tab === t.key ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                fontWeight: tab === t.key ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Friends list */}
        {tab === 'friends' && (
          <div className="space-y-2">
            {friends.length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                No friends yet. Add someone by email above.
              </p>
            ) : (
              friends.map((f) => (
                <div
                  key={f.friendshipId}
                  className="flex items-center justify-between p-3 rounded-xl"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
                >
                  <div>
                    <p className="text-sm font-medium">{f.name}</p>
                    <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>{f.email}</p>
                  </div>
                  <button
                    onClick={() => removeFriend(f.friendshipId)}
                    className="text-xs px-2 py-1 rounded transition-colors"
                    style={{ color: 'var(--ink-blocked)' }}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}

            {sent.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--ink-text-muted)' }}>
                  Sent Requests
                </p>
                {sent.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-xl mb-1"
                    style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
                  >
                    <div>
                      <p className="text-sm">{s.toName}</p>
                      <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>{s.toEmail}</p>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--ink-pending)' }}>Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Incoming Requests */}
        {tab === 'requests' && (
          <div className="space-y-2">
            {requests.length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                No pending friend requests.
              </p>
            ) : (
              requests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 rounded-xl"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
                >
                  <div>
                    <p className="text-sm font-medium">{r.fromName}</p>
                    <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>{r.fromEmail}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respond(r.id, 'accept')}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: 'var(--ink-done)', color: 'var(--ink-on-accent)' }}
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => respond(r.id, 'reject')}
                      className="text-xs px-3 py-1 rounded"
                      style={{ color: 'var(--ink-blocked)', border: '1px solid var(--ink-blocked)' }}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Shared tasks */}
        {tab === 'shared' && (
          <div className="space-y-2">
            {sharedTasks.length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                No tasks shared with you yet.
              </p>
            ) : (
              sharedTasks.map((t) => (
                <div
                  key={t.id + t.sharedAt}
                  className="p-3 rounded-xl"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: statusColor(t.status), color: 'var(--ink-on-accent)' }}
                    >
                      {t.status.replace('_', ' ')}
                    </span>
                    <span className="text-sm font-medium flex-1">{t.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                    <span>from {t.sharedByName}</span>
                    <span>{t.workspaceName}</span>
                    <span>{t.permission}</span>
                    {t.dueDate && <span>due {new Date(t.dueDate).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </AuthShell>
  );
}
