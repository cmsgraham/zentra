'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

interface Props {
  taskIds: string[];
  members?: { id: string; name: string }[];
  /** Optional list of workspaces the user belongs to. When provided, the
   *  modal exposes a "Move to space" field so bulk edits can also relocate
   *  intentions across spaces. */
  workspaces?: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

const statuses = ['pending', 'in_progress', 'blocked', 'done'] as const;
const priorities = ['low', 'medium', 'high', 'critical'] as const;

export default function BulkEditModal({ taskIds, members = [], workspaces = [], onClose, onDone }: Props) {
  // Each field has an "enabled" flag — only enabled fields are sent.
  const [enabled, setEnabled] = useState({
    description: false,
    status: false,
    priority: false,
    dueDate: false,
    estimatedMinutes: false,
    complexity: false,
    assigneeId: false,
    workspaceId: false,
  });
  const [form, setForm] = useState({
    description: '',
    status: 'pending' as typeof statuses[number],
    priority: 'medium' as typeof priorities[number],
    dueDate: '',
    estimatedMinutes: '',
    complexity: '1',
    assigneeId: '',
    workspaceId: '',
    blockedReason: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(field: keyof typeof enabled) {
    setEnabled((e) => ({ ...e, [field]: !e[field] }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const updates: Record<string, unknown> = {};
    if (enabled.description) updates.description = form.description || null;
    if (enabled.status) {
      updates.status = form.status;
      if (form.status === 'blocked') {
        if (!form.blockedReason.trim()) {
          setError('Tell us what you’re waiting on before setting status to Waiting on….');
          return;
        }
        updates.blockedReason = form.blockedReason.trim();
      }
    }
    if (enabled.priority) updates.priority = form.priority;
    if (enabled.dueDate) updates.dueDate = form.dueDate || null;
    if (enabled.estimatedMinutes) {
      updates.estimatedMinutes = form.estimatedMinutes ? parseInt(form.estimatedMinutes) : null;
    }
    if (enabled.complexity) updates.complexity = parseInt(form.complexity) || 1;
    if (enabled.assigneeId) updates.assigneeId = form.assigneeId || null;
    if (enabled.workspaceId) {
      if (!form.workspaceId) {
        setError('Pick a space to move the intentions to.');
        return;
      }
      updates.workspaceId = form.workspaceId;
    }

    if (Object.keys(updates).length === 0) {
      setError('Enable at least one field to apply.');
      return;
    }

    setSaving(true);
    try {
      await api('/tasks/bulk', {
        method: 'PATCH',
        body: { taskIds, updates },
      });
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update intentions');
      setSaving(false);
    }
  }

  const fieldRow = (
    key: keyof typeof enabled,
    label: string,
    input: React.ReactNode,
  ) => (
    <label className="flex items-start gap-2 py-2">
      <input
        type="checkbox"
        checked={enabled[key]}
        onChange={() => toggle(key)}
        className="mt-1.5"
      />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium block mb-1" style={{ color: enabled[key] ? 'var(--ink-text)' : 'var(--ink-text-muted)' }}>
          {label}
        </span>
        <div style={{ opacity: enabled[key] ? 1 : 0.45, pointerEvents: enabled[key] ? 'auto' : 'none' }}>
          {input}
        </div>
      </div>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md p-5 space-y-2 z-overlay z-animate-in"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Edit {taskIds.length} intention{taskIds.length > 1 ? 's' : ''}</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>✕</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          Check a field to apply its value to every selected intention. Unchecked fields are left alone.
        </p>

        {fieldRow('status', 'Status', (
          <select className="z-input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
            <option value="pending">Open</option>
            <option value="in_progress">Present</option>
            <option value="blocked">Waiting on…</option>
            <option value="done">I did it!</option>
          </select>
        ))}

        {enabled.status && form.status === 'blocked' && (
          <div className="pl-7">
            <input
              className="z-input"
              placeholder="What are you waiting on? (required)"
              value={form.blockedReason}
              onChange={(e) => setForm((f) => ({ ...f, blockedReason: e.target.value }))}
            />
          </div>
        )}

        {fieldRow('priority', 'Priority', (
          <select className="z-input" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as any }))}>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ))}

        {fieldRow('dueDate', 'Due date', (
          <input type="date" className="z-input" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
        ))}

        {fieldRow('estimatedMinutes', 'Time estimate (minutes)', (
          <input
            type="number"
            min={1}
            max={480}
            className="z-input"
            value={form.estimatedMinutes}
            onChange={(e) => setForm((f) => ({ ...f, estimatedMinutes: e.target.value }))}
            placeholder="Leave blank to clear"
          />
        ))}

        {fieldRow('complexity', 'Complexity (1–3)', (
          <select className="z-input" value={form.complexity} onChange={(e) => setForm((f) => ({ ...f, complexity: e.target.value }))}>
            <option value="1">1 — low</option>
            <option value="2">2 — medium</option>
            <option value="3">3 — high</option>
          </select>
        ))}

        {fieldRow('assigneeId', 'Assignee', (
          <select className="z-input" value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        ))}

        {workspaces.length > 0 && fieldRow('workspaceId', 'Move to space', (
          <select className="z-input" value={form.workspaceId} onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))}>
            <option value="">Choose a space…</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ))}

        {fieldRow('description', 'Description', (
          <textarea
            className="z-input"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Leave blank to clear the description on all selected intentions"
          />
        ))}

        {error && <p className="text-xs" style={{ color: 'var(--ink-blocked)' }}>{error}</p>}

        <div className="flex gap-2 pt-3">
          <button type="button" onClick={onClose} className="z-btn flex-1">Cancel</button>
          <button type="submit" disabled={saving} className="z-btn z-btn-primary flex-1">
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </form>
    </div>
  );
}
