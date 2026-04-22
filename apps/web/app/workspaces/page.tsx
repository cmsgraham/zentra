'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import { api } from '@/lib/api-client';

interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  token: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  useEffect(() => { loadWorkspaces(); loadInvites(); }, []);

  async function loadWorkspaces() {
    const data = await api<{ items: Workspace[] }>('/workspaces');
    setWorkspaces(data.items);
  }

  async function loadInvites() {
    try {
      const data = await api<{ items: PendingInvite[] }>('/workspaces/invites/pending');
      setInvites(data.items);
    } catch { /* ignore if endpoint not available */ }
  }

  async function acceptInvite(token: string) {
    setAccepting(token);
    try {
      await api('/workspaces/invites/accept', { method: 'POST', body: { token } });
      await loadWorkspaces();
      await loadInvites();
    } catch (err: any) {
      alert(err.message || 'Failed to accept invite');
    }
    setAccepting(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    const ws = await api<Workspace>('/workspaces', { method: 'POST', body: { name } });
    setCreating(false);
    setShowCreate(false);
    setName('');
    router.push(`/workspaces/${ws.id}`);
  }

  return (
    <AuthShell>
      <div className="min-h-[calc(100vh-56px)] flex flex-col">

        {/* ── Content ── */}
        <div className="flex-1 max-w-2xl w-full mx-auto px-6 pt-10 pb-10">

          {/* Minimal header with inline create button */}
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                Your system starts here
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 active:scale-[0.97]"
              style={{ background: 'var(--ink-accent)' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
              </svg>
              New
            </button>
          </div>

          {/* Canvas quick-access */}
          <button
            onClick={() => router.push('/planner')}
            className="w-full text-left group mb-8 p-4 rounded-xl transition-all duration-200"
            style={{
              background: 'var(--ink-surface)',
              boxShadow: '0 0 0 1px var(--ink-border)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 0 0 1px var(--ink-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 0 0 1px var(--ink-border)';
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'var(--ink-subtle)', color: 'var(--ink-accent)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-sm">Canvas</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                  Goals, schedule &amp; mood — across all your spaces
                </p>
              </div>
              <svg className="ml-auto opacity-30" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4l4 4-4 4" />
              </svg>
            </div>
          </button>

          {/* Pending invites */}
          {invites.length > 0 && (
            <div className="mb-8">
              <p
                className="text-[11px] font-medium uppercase tracking-widest mb-3 px-0.5"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Pending invites
              </p>
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-4 rounded-xl"
                    style={{
                      background: 'var(--ink-surface)',
                      boxShadow: '0 0 0 1px var(--ink-border)',
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-sm truncate">{inv.workspaceName}</h3>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                          Invited by {inv.invitedByName} · {inv.role}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => acceptInvite(inv.token)}
                      disabled={accepting === inv.token}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50 transition-colors hover:opacity-90 active:scale-[0.97] shrink-0"
                      style={{ background: 'var(--ink-accent)' }}
                    >
                      {accepting === inv.token ? 'Joining…' : 'Accept'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Workspace cards */}
          {workspaces.length > 0 && (
            <div>
              <p
                className="text-[11px] font-medium uppercase tracking-widest mb-3 px-0.5"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                All spaces
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => router.push(`/workspaces/${ws.id}`)}
                    className="text-left p-4 rounded-xl transition-all duration-150 group"
                    style={{
                      background: 'var(--ink-surface)',
                      boxShadow: '0 0 0 1px var(--ink-border)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 0 1px var(--ink-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 0 1px var(--ink-border)';
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          background: 'var(--ink-subtle)',
                          color: 'var(--ink-accent)',
                        }}
                      >
                        {ws.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-sm truncate">{ws.name}</h3>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Create Modal ── */}
        {showCreate && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowCreate(false)}
          >
            <form
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleCreate}
              className="w-full max-w-sm rounded-2xl p-6 space-y-5"
              style={{
                background: 'var(--ink-surface)',
                boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
              }}
            >
              <div>
                <h2 className="text-lg font-semibold">Create Space</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>
                  Give your space a name to get started.
                </p>
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Personal, Work, Side Project"
                required
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-shadow focus:ring-2"
                style={{
                  border: '1px solid var(--ink-border)',
                  background: 'var(--ink-bg)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              />
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors hover:opacity-90 active:scale-[0.97]"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
