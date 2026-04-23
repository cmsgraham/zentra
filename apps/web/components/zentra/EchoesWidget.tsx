'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

interface Echo {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
  isOwner: boolean;
}

/**
 * Echoes widget — quiet things to remember, surfaced inline on Flow.
 * Supports add, complete, edit. For sharing/converting, opens the full /reminders page.
 */
export function EchoesWidget() {
  const router = useRouter();
  const [echoes, setEchoes] = useState<Echo[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDueAt, setEditDueAt] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  async function load() {
    try {
      const r = await api<{ items: Echo[] }>('/reminders');
      setEchoes(r.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api('/reminders', {
      method: 'POST',
      body: {
        title: title.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      },
    });
    setTitle('');
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

  function startEdit(r: Echo) {
    setEditId(r.id);
    setEditTitle(r.title);
    setEditNotes(r.notes ?? '');
    setEditDueAt(r.dueAt ? r.dueAt.slice(0, 16) : '');
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

  function formatDue(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today ${timeStr}`;
    if (diffDays === 1) return `Tomorrow ${timeStr}`;
    if (diffDays === -1) return `Yesterday ${timeStr}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${timeStr}`;
  }

  function isOverdue(r: Echo) {
    return r.dueAt && !r.completedAt && new Date(r.dueAt) < new Date();
  }

  const active = echoes.filter((r) => !r.completedAt);
  const completed = echoes.filter((r) => !!r.completedAt);
  const visible = showCompleted ? completed : active;

  return (
    <div
      style={{
        background: 'var(--ink-surface)',
        border: '1px solid var(--ink-border-subtle)',
        borderRadius: '14px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--ink-text)', margin: 0 }}>
            Echoes
          </h2>
          <span style={{ fontSize: '0.6875rem', color: 'var(--ink-text-faint)' }}>
            {active.length} open
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="z-btn z-btn-ghost z-btn-sm"
            style={{ fontSize: '0.6875rem', color: 'var(--ink-text-muted)' }}
            title={showCompleted ? 'Show active' : 'Show completed'}
          >
            {showCompleted ? 'Active' : 'Done'}
          </button>
          <button
            onClick={() => router.push('/reminders')}
            className="z-btn z-btn-ghost z-btn-sm"
            style={{ fontSize: '0.6875rem', color: 'var(--ink-text-muted)' }}
            title="Open full Echoes page"
          >
            Open
          </button>
        </div>
      </div>

      {/* Add form */}
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Capture an echo…"
          style={{
            width: '100%',
            fontSize: '0.8125rem',
            padding: '8px 10px',
            borderRadius: '8px',
            background: 'var(--ink-bg)',
            border: '1px solid var(--ink-border-subtle)',
            color: 'var(--ink-text)',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            style={{
              flex: 1,
              fontSize: '0.6875rem',
              padding: '6px 8px',
              borderRadius: '6px',
              background: 'var(--ink-bg)',
              border: '1px solid var(--ink-border-subtle)',
              color: 'var(--ink-text-secondary)',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="z-btn z-btn-primary z-btn-sm"
            style={{ fontSize: '0.75rem', opacity: title.trim() ? 1 : 0.4 }}
          >
            Add
          </button>
        </div>
      </form>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '280px', overflowY: 'auto' }}>
        {loading ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-text-faint)', padding: '8px 0', textAlign: 'center' }}>
            Loading…
          </p>
        ) : visible.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--ink-text-faint)', padding: '12px 0', textAlign: 'center' }}>
            {showCompleted ? 'No completed echoes' : 'Nothing echoing right now'}
          </p>
        ) : (
          visible.map((r) =>
            editId === r.id ? (
              <form key={r.id} onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', borderRadius: '8px', background: 'var(--ink-bg)', border: '1px solid var(--ink-border)' }}>
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{ fontSize: '0.8125rem', padding: '6px 8px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text)', outline: 'none' }}
                />
                <input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  style={{ fontSize: '0.6875rem', padding: '4px 8px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text-secondary)', outline: 'none' }}
                />
                <input
                  type="datetime-local"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                  style={{ fontSize: '0.6875rem', padding: '4px 8px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--ink-border-subtle)', color: 'var(--ink-text-secondary)', outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEditId(null)} className="z-btn z-btn-ghost z-btn-sm" style={{ fontSize: '0.6875rem' }}>
                    Cancel
                  </button>
                  <button type="submit" className="z-btn z-btn-primary z-btn-sm" style={{ fontSize: '0.6875rem' }}>
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <EchoRow
                key={r.id}
                echo={r}
                isOverdue={!!isOverdue(r)}
                dueLabel={formatDue(r.dueAt)}
                onToggle={() => handleToggle(r.id)}
                onEdit={r.isOwner ? () => startEdit(r) : undefined}
                onDelete={r.isOwner ? () => handleDelete(r.id) : undefined}
              />
            )
          )
        )}
      </div>
    </div>
  );
}

function EchoRow({
  echo,
  isOverdue,
  dueLabel,
  onToggle,
  onEdit,
  onDelete,
}: {
  echo: Echo;
  isOverdue: boolean;
  dueLabel: string | null;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const done = !!echo.completedAt;
  return (
    <div
      className="group"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '6px 8px',
        borderRadius: '6px',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ink-bg)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <button
        onClick={onToggle}
        style={{
          marginTop: '2px',
          width: '14px',
          height: '14px',
          borderRadius: '999px',
          border: `1.5px solid ${done ? 'var(--ink-done)' : isOverdue ? 'var(--ink-blocked)' : 'var(--ink-border)'}`,
          background: done ? 'var(--ink-done)' : 'transparent',
          flexShrink: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label={done ? 'Mark active' : 'Mark complete'}
      >
        {done && (
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,5.5 4,7.5 8,3" />
          </svg>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: '0.8125rem',
            margin: 0,
            color: done ? 'var(--ink-text-muted)' : 'var(--ink-text)',
            textDecoration: done ? 'line-through' : 'none',
            lineHeight: 1.4,
          }}
        >
          {echo.title}
        </p>
        {(dueLabel || echo.notes) && (
          <p
            style={{
              fontSize: '0.6875rem',
              margin: '2px 0 0',
              color: isOverdue && !done ? 'var(--ink-blocked)' : 'var(--ink-text-faint)',
            }}
          >
            {dueLabel}
            {dueLabel && echo.notes ? ' · ' : ''}
            {echo.notes}
          </p>
        )}
      </div>
      <div
        className="opacity-0 group-hover:opacity-100"
        style={{ display: 'flex', gap: '2px', transition: 'opacity 0.15s' }}
      >
        {onEdit && (
          <button
            onClick={onEdit}
            style={{
              fontSize: '0.625rem',
              color: 'var(--ink-text-muted)',
              background: 'transparent',
              border: 'none',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            style={{
              fontSize: '0.625rem',
              color: 'var(--ink-blocked)',
              background: 'transparent',
              border: 'none',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
