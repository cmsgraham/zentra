'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

interface MemberItem {
  user: { id: string; email: string; name: string };
  role: string;
}

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export default function WorkspaceMembersModal({ workspaceId, onClose }: Props) {
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [myRole, setMyRole] = useState<string>('member');

  async function loadMembers() {
    const data = await api<{ items: MemberItem[] }>(`/workspaces/${workspaceId}/members?pageSize=100`);
    setMembers(data.items);
  }

  useEffect(() => {
    loadMembers();
  }, [workspaceId]);

  useEffect(() => {
    // Detect current user's role
    const token = localStorage.getItem('zentra_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const me = members.find(m => m.user.id === payload.sub);
        if (me) setMyRole(me.role);
      } catch { /* ignore */ }
    }
  }, [members]);

  const canInvite = myRole === 'owner' || myRole === 'admin';

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setMessage(null);
    try {
      await api(`/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        body: { email: email.trim(), role },
      });
      setMessage({ text: `Invite sent to ${email.trim()}` });
      setEmail('');
    } catch (err: any) {
      setMessage({ text: err.message || 'Failed to send invite', error: true });
    }
    setSending(false);
  }

  const roleLabel = (r: string) => {
    if (r === 'owner') return 'Owner';
    if (r === 'admin') return 'Admin';
    return 'Member';
  };

  const roleColor = (r: string) => {
    if (r === 'owner') return 'var(--ink-accent)';
    if (r === 'admin') return 'var(--ink-in-progress, #3b82f6)';
    return 'var(--ink-text-muted)';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 z-animate-fade"
      style={{ background: 'var(--ink-overlay)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-6 z-animate-in"
        style={{
          background: 'var(--ink-surface)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold">Space Members</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
              {members.length} member{members.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>

        {/* Invite form (owner/admin only) */}
        {canInvite && (
          <form onSubmit={handleInvite} className="mb-5">
            <p className="text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--ink-text-muted)' }}>
              Invite someone
            </p>
            <div className="flex gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                type="email"
                required
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-shadow focus:ring-2"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' }}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
                className="px-2 py-2 rounded-lg text-xs"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={sending}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors hover:opacity-90 active:scale-[0.97]"
                style={{ background: 'var(--ink-accent)' }}
              >
                {sending ? '…' : 'Invite'}
              </button>
            </div>
            {message && (
              <p
                className="text-xs mt-2 px-2 py-1.5 rounded-lg"
                style={{
                  background: message.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                  color: message.error ? 'var(--ink-blocked)' : 'var(--ink-done, #10b981)',
                }}
              >
                {message.text}
              </p>
            )}
          </form>
        )}

        {/* Members list */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--ink-text-muted)' }}>
            Members
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {members.map((m) => (
              <div
                key={m.user.id}
                className="flex items-center justify-between p-2.5 rounded-xl"
                style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border)' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ background: 'var(--ink-subtle)', color: 'var(--ink-accent)' }}
                  >
                    {m.user.name?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.user.name}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--ink-text-muted)' }}>{m.user.email}</p>
                  </div>
                </div>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                  style={{ color: roleColor(m.role), background: 'var(--ink-subtle)' }}
                >
                  {roleLabel(m.role)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
