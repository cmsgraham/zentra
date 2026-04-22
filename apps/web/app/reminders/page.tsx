'use client';

import { useEffect, useState, type FormEvent } from 'react';
import AuthShell from '@/components/layout/AuthShell';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
}

interface Friend {
  id: string;
  name: string;
  email: string;
}

interface ShareEntry {
  shareId: string;
  userId: string;
  name: string;
  email: string;
}

interface Workspace {
  id: string;
  name: string;
}

export default function RemindersPage() {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Form
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState('');

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDueAt, setEditDueAt] = useState('');

  // Share modal
  const [shareReminderId, setShareReminderId] = useState<string | null>(null);
  const [shareFriendId, setShareFriendId] = useState('');
  const [shares, setShares] = useState<ShareEntry[]>([]);

  // Convert modal
  const [convertReminderId, setConvertReminderId] = useState<string | null>(null);
  const [convertWorkspaceId, setConvertWorkspaceId] = useState('');
  const [convertPriority, setConvertPriority] = useState('medium');

  // Filter
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active');

  async function load() {
    const [r, f, w] = await Promise.all([
      api<{ items: Reminder[] }>('/reminders'),
      api<{ items: Friend[] }>('/friends').catch(() => ({ items: [] })),
      api<{ items: Workspace[] }>('/workspaces').catch(() => ({ items: [] })),
    ]);
    setReminders(r.items);
    setFriends(f.items);
    setWorkspaces(w.items);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api('/reminders', {
      method: 'POST',
      body: {
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      },
    });
    setTitle('');
    setNotes('');
    setDueAt('');
    load();
  }

  async function handleToggle(id: string) {
    await api(`/reminders/${id}/toggle`, { method: 'POST' });
    load();
  }

  async function handleDelete(id: string) {
    await api(`/reminders/${id}`, { method: 'DELETE' });
    load();
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editId || !editTitle.trim()) return;
    await api(`/reminders/${editId}`, {
      method: 'PATCH',
      body: {
        title: editTitle.trim(),
        notes: editNotes.trim() || null,
        dueAt: editDueAt ? new Date(editDueAt).toISOString() : null,
      },
    });
    setEditId(null);
    load();
  }

  function startEdit(r: Reminder) {
    setEditId(r.id);
    setEditTitle(r.title);
    setEditNotes(r.notes ?? '');
    setEditDueAt(r.dueAt ? r.dueAt.slice(0, 16) : '');
  }

  async function openShareModal(id: string) {
    setShareReminderId(id);
    setShareFriendId('');
    const s = await api<{ items: ShareEntry[] }>(`/reminders/${id}/shares`);
    setShares(s.items);
  }

  async function handleShare(e: FormEvent) {
    e.preventDefault();
    if (!shareReminderId || !shareFriendId) return;
    await api(`/reminders/${shareReminderId}/share`, {
      method: 'POST',
      body: { friendId: shareFriendId },
    });
    const s = await api<{ items: ShareEntry[] }>(`/reminders/${shareReminderId}/shares`);
    setShares(s.items);
    setShareFriendId('');
  }

  async function handleUnshare(shareId: string) {
    if (!shareReminderId) return;
    await api(`/reminders/${shareReminderId}/share/${shareId}`, { method: 'DELETE' });
    const s = await api<{ items: ShareEntry[] }>(`/reminders/${shareReminderId}/shares`);
    setShares(s.items);
  }

  async function handleConvert(e: FormEvent) {
    e.preventDefault();
    if (!convertReminderId || !convertWorkspaceId) return;
    await api(`/reminders/${convertReminderId}/convert`, {
      method: 'POST',
      body: { workspaceId: convertWorkspaceId, priority: convertPriority },
    });
    setConvertReminderId(null);
    load();
  }

  function formatDue(iso: string | null) {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today ${timeStr}`;
    if (diffDays === 1) return `Tomorrow ${timeStr}`;
    if (diffDays === -1) return `Yesterday ${timeStr}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${timeStr}`;
  }

  function isOverdue(r: Reminder) {
    return r.dueAt && !r.completedAt && new Date(r.dueAt) < new Date();
  }

  const filtered = reminders.filter((r) => {
    if (filter === 'active') return !r.completedAt;
    if (filter === 'completed') return !!r.completedAt;
    return true;
  });

  const myReminders = filtered.filter((r) => r.isOwner);
  const sharedWithMe = filtered.filter((r) => !r.isOwner);

  return (
    <AuthShell>
      <div className="max-w-2xl mx-auto p-6 sm:p-8">
        <h1 className="text-xl font-bold mb-6" style={{ color: 'var(--ink-text)' }}>Reminders</h1>

        {/* Create form */}
        <form onSubmit={handleCreate} className="rounded-xl p-4 mb-6" style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
                e.preventDefault();
                handleCreate(e);
              }
            }}
            placeholder="Add a reminder… (press Enter)"
            className="w-full text-sm bg-transparent outline-none mb-2"
            style={{ color: 'var(--ink-text)' }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="flex-1 min-w-0 text-xs bg-transparent outline-none px-2 py-1.5 rounded-md"
              style={{ color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border-subtle)' }}
            />
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-md bg-transparent"
              style={{ color: 'var(--ink-text-secondary)', border: '1px solid var(--ink-border-subtle)' }}
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="text-xs px-3 py-1.5 rounded-md font-medium transition-opacity disabled:opacity-30"
              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)' }}
            >
              Add
            </button>
          </div>
        </form>

        {/* Filters */}
        <div className="flex gap-1 mb-4">
          {(['active', 'completed', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-xs px-3 py-1 rounded-full font-medium capitalize transition-all"
              style={{
                background: filter === f ? 'var(--ink-accent)' : 'transparent',
                color: filter === f ? 'var(--ink-on-accent)' : 'var(--ink-text-muted)',
                border: filter === f ? 'none' : '1px solid var(--ink-border-subtle)',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* My reminders */}
        {myReminders.length > 0 && (
          <div className="mb-6">
            <p className="text-[11px] uppercase tracking-wider mb-2 font-semibold" style={{ color: 'var(--ink-text-muted)' }}>My Reminders</p>
            <div className="flex flex-col gap-1.5">
              {myReminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  isOverdue={!!isOverdue(r)}
                  formatDue={formatDue}
                  onToggle={() => handleToggle(r.id)}
                  onEdit={() => startEdit(r)}
                  onDelete={() => handleDelete(r.id)}
                  onShare={() => openShareModal(r.id)}
                  onConvert={() => { setConvertReminderId(r.id); setConvertWorkspaceId(workspaces[0]?.id ?? ''); }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Shared with me */}
        {sharedWithMe.length > 0 && (
          <div className="mb-6">
            <p className="text-[11px] uppercase tracking-wider mb-2 font-semibold" style={{ color: 'var(--ink-text-muted)' }}>Shared with me</p>
            <div className="flex flex-col gap-1.5">
              {sharedWithMe.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  isOverdue={!!isOverdue(r)}
                  formatDue={formatDue}
                  onToggle={() => handleToggle(r.id)}
                  onConvert={() => { setConvertReminderId(r.id); setConvertWorkspaceId(workspaces[0]?.id ?? ''); }}
                  showOwner
                />
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <p className="text-center text-sm py-10" style={{ color: 'var(--ink-text-muted)' }}>
            {filter === 'active' ? 'No active reminders' : filter === 'completed' ? 'No completed reminders' : 'No reminders yet'}
          </p>
        )}

        {/* Edit modal */}
        {editId && (
          <Modal onClose={() => setEditId(null)} title="Edit Reminder">
            <form onSubmit={handleUpdate} className="flex flex-col gap-3">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-sm bg-transparent outline-none px-3 py-2 rounded-lg"
                style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
              />
              <input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes"
                className="w-full text-xs bg-transparent outline-none px-3 py-2 rounded-lg"
                style={{ border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text-secondary)' }}
              />
              <input
                type="datetime-local"
                value={editDueAt}
                onChange={(e) => setEditDueAt(e.target.value)}
                className="text-xs px-3 py-2 rounded-lg bg-transparent"
                style={{ border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text-secondary)' }}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setEditId(null)} className="text-xs px-3 py-1.5 rounded-md" style={{ color: 'var(--ink-text-muted)' }}>Cancel</button>
                <button type="submit" className="text-xs px-4 py-1.5 rounded-md font-medium" style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)' }}>Save</button>
              </div>
            </form>
          </Modal>
        )}

        {/* Share modal */}
        {shareReminderId && (
          <Modal onClose={() => setShareReminderId(null)} title="Share Reminder">
            <form onSubmit={handleShare} className="flex gap-2 mb-4">
              <select
                value={shareFriendId}
                onChange={(e) => setShareFriendId(e.target.value)}
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-transparent"
                style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
              >
                <option value="">Select a friend…</option>
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.email})</option>
                ))}
              </select>
              <button type="submit" disabled={!shareFriendId} className="text-xs px-4 py-1.5 rounded-md font-medium disabled:opacity-30" style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)' }}>Share</button>
            </form>
            {shares.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--ink-text-muted)' }}>Shared with</p>
                {shares.map((s) => (
                  <div key={s.shareId} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--ink-subtle)' }}>
                    <span style={{ color: 'var(--ink-text)' }}>{s.name} <span style={{ color: 'var(--ink-text-muted)' }}>({s.email})</span></span>
                    <button onClick={() => handleUnshare(s.shareId)} className="text-[10px] font-medium" style={{ color: 'var(--ink-blocked)' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        )}

        {/* Convert to intention modal */}
        {convertReminderId && (
          <Modal onClose={() => setConvertReminderId(null)} title="Convert to Intention">
            <form onSubmit={handleConvert} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--ink-text-muted)' }}>Space</label>
                <select
                  value={convertWorkspaceId}
                  onChange={(e) => setConvertWorkspaceId(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-transparent"
                  style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--ink-text-muted)' }}>Priority</label>
                <select
                  value={convertPriority}
                  onChange={(e) => setConvertPriority(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-transparent"
                  style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setConvertReminderId(null)} className="text-xs px-3 py-1.5 rounded-md" style={{ color: 'var(--ink-text-muted)' }}>Cancel</button>
                <button type="submit" disabled={!convertWorkspaceId} className="text-xs px-4 py-1.5 rounded-md font-medium disabled:opacity-30" style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)' }}>Convert</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </AuthShell>
  );
}

/* ── Reminder row ── */
function ReminderRow({ reminder: r, isOverdue, formatDue, onToggle, onEdit, onDelete, onShare, onConvert, showOwner }: {
  reminder: Reminder;
  isOverdue: boolean;
  formatDue: (iso: string | null) => string | null;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onShare?: () => void;
  onConvert?: () => void;
  showOwner?: boolean;
}) {
  const done = !!r.completedAt;
  const dueStr = formatDue(r.dueAt);

  return (
    <div
      className="flex items-start gap-3 px-3.5 py-2.5 rounded-xl transition-all group"
      style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className="mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
        style={{
          borderColor: done ? 'var(--ink-done)' : isOverdue ? 'var(--ink-blocked)' : 'var(--ink-border)',
          background: done ? 'var(--ink-done)' : 'transparent',
        }}
      >
        {done && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,5.5 4,7.5 8,3"/>
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug" style={{ color: done ? 'var(--ink-text-muted)' : 'var(--ink-text)', textDecoration: done ? 'line-through' : 'none' }}>
          {r.title}
        </p>
        {r.notes && (
          <p className="text-[11px] mt-0.5 line-clamp-1" style={{ color: 'var(--ink-text-muted)' }}>{r.notes}</p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {dueStr && (
            <span className="text-[10px] font-medium" style={{ color: isOverdue ? 'var(--ink-blocked)' : 'var(--ink-text-muted)' }}>
              {isOverdue ? '⏰ ' : ''}{dueStr}
            </span>
          )}
          {showOwner && (
            <span className="text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>from {r.ownerName}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {onConvert && !done && (
          <button onClick={onConvert} title="Convert to intention" className="p-1 rounded hover:bg-[var(--ink-surface-hover)] transition-colors" style={{ color: 'var(--ink-text-muted)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
          </button>
        )}
        {onShare && (
          <button onClick={onShare} title="Share" className="p-1 rounded hover:bg-[var(--ink-surface-hover)] transition-colors" style={{ color: 'var(--ink-text-muted)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} title="Edit" className="p-1 rounded hover:bg-[var(--ink-surface-hover)] transition-colors" style={{ color: 'var(--ink-text-muted)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="Delete" className="p-1 rounded hover:bg-[var(--ink-surface-hover)] transition-colors" style={{ color: 'var(--ink-blocked)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Modal ── */
function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: 'var(--ink-overlay)' }} onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-md rounded-2xl p-5"
        style={{ background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-lg)' }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-text)' }}>{title}</h2>
        {children}
      </div>
    </>
  );
}
