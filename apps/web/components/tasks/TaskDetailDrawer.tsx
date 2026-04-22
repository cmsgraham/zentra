'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

interface TaskDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueDate?: string;
  estimatedMinutes?: number;
  complexity?: number;
  blockedReason?: string;
  assigneeId?: string;
  tags?: string[];
  hasSegments?: boolean;
  segmentProgress?: { completed: number; total: number } | null;
  recurrenceType?: string | null;
  recurrenceInterval?: number;
  recurrenceEndDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Segment {
  id: string;
  parentTaskId: string;
  title: string;
  sequenceNumber: number;
  totalSegments: number;
  estimatedMinutes?: number;
  dueDate?: string | null;
  status: string;
  completedAt?: string;
}

interface Comment {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
}

interface Activity {
  id: string;
  actionType: string;
  actorId: string;
  beforeJson?: Record<string, unknown>;
  afterJson?: Record<string, unknown>;
  createdAt: string;
}

interface Suggestion {
  suggestedTitle?: string;
  suggestedDescription?: string;
  suggestedPriority?: string;
  reasoning: string;
  similarTasks?: { id: string; title: string; similarity: number }[];
}

interface Props {
  taskId: string;
  workspaceId: string;
  onClose: () => void;
  onUpdated?: () => void;
  members?: { id: string; name: string }[];
  workspaces?: { id: string; name: string }[];
}

const statuses = ['pending', 'in_progress', 'blocked', 'done'];
const statusLabels: Record<string, string> = {
  pending: 'Open',
  in_progress: 'Present',
  blocked: 'Waiting on…',
  done: 'I did it!',
};
const priorities = ['low', 'medium', 'high', 'critical'];
const priorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export default function TaskDetailDrawer({ taskId, workspaceId, onClose, onUpdated, members = [], workspaces = [] }: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [newComment, setNewComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', status: '', priority: '', dueDate: '', blockedReason: '', assigneeId: '', estimatedMinutes: '', complexity: '1' });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [showSplit, setShowSplit] = useState(false);
  const [splitMode, setSplitMode] = useState<'equal' | 'phases'>('equal');
  const [splitCount, setSplitCount] = useState('3');
  const [splitPhases, setSplitPhases] = useState<{ title: string; estimatedMinutes: string; dueDate: string }[]>([{ title: '', estimatedMinutes: '', dueDate: '' }, { title: '', estimatedMinutes: '', dueDate: '' }]);
  const [splitting, setSplitting] = useState(false);
  const [splitRecurrence, setSplitRecurrence] = useState('');
  const [splitRecurrenceInterval, setSplitRecurrenceInterval] = useState('1');
  const [splitEqualDates, setSplitEqualDates] = useState<string[]>([]);

  useEffect(() => {
    loadTask();
    loadComments();
    loadActivity();
  }, [taskId]);

  async function loadTask() {
    const t = await api<TaskDetail>(`/tasks/${taskId}`);
    setTask(t);
    setForm({
      title: t.title,
      description: t.description ?? '',
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '',
      blockedReason: t.blockedReason ?? '',
      assigneeId: t.assigneeId ?? '',
      estimatedMinutes: t.estimatedMinutes ? String(t.estimatedMinutes) : '',
      complexity: String(t.complexity ?? 1),
    });
    if (t.hasSegments) {
      const data = await api<{ segments: Segment[] }>(`/tasks/${taskId}/segments`);
      setSegments(data.segments);
    } else {
      setSegments([]);
    }
  }

  async function loadComments() {
    const data = await api<{ items: Comment[] }>(`/tasks/${taskId}/comments`);
    setComments(data.items);
  }

  async function loadActivity() {
    const data = await api<{ items: Activity[] }>(`/tasks/${taskId}/activity`);
    setActivities(data.items);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      title: form.title,
      description: form.description || null,
      status: form.status,
      priority: form.priority,
      dueDate: form.dueDate || null,
      assigneeId: form.assigneeId || null,
      estimatedMinutes: form.estimatedMinutes ? parseInt(form.estimatedMinutes) : null,
      complexity: parseInt(form.complexity) || 1,
    };
    if (form.status === 'blocked') body.blockedReason = form.blockedReason;
    const dueDateChanged = form.dueDate !== (task?.dueDate ? task.dueDate.slice(0, 10) : '');
    await api(`/tasks/${taskId}`, { method: 'PATCH', body });

    // If due date changed and task has segments + recurrence, recalculate segment dates
    if (dueDateChanged && form.dueDate && segments.length > 0 && task?.recurrenceType) {
      const base = new Date(form.dueDate + 'T00:00:00');
      const recType = task.recurrenceType;
      const recInt = task.recurrenceInterval ?? 1;
      for (let i = 0; i < segments.length; i++) {
        const d = new Date(base);
        if (recType === 'daily') d.setDate(d.getDate() + i * recInt);
        else if (recType === 'weekly') d.setDate(d.getDate() + i * recInt * 7);
        else if (recType === 'monthly') d.setMonth(d.getMonth() + i * recInt);
        const dateStr = d.toLocaleDateString('en-CA');
        await api(`/task-segments/${segments[i].id}`, { method: 'PATCH', body: { dueDate: dateStr } });
      }
    }

    setEditing(false);
    onUpdated?.();
    onClose();
  }

  async function handleAddComment(e: FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    await api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body: newComment } });
    setNewComment('');
    loadComments();
  }

  async function handleImprove() {
    setLoadingSuggestion(true);
    setSuggestion(null);
    try {
      const result = await api<Suggestion>(`/tasks/${taskId}/ai/improve`, { method: 'POST' });
      setSuggestion(result);
    } catch { /* ignore */ }
    setLoadingSuggestion(false);
  }

  async function handleDelete() {
    if (!confirm('Delete this intention?')) return;
    await api(`/tasks/${taskId}`, { method: 'DELETE' });
    onClose();
    onUpdated?.();
  }

  async function handleMoveWorkspace(targetId: string) {
    if (targetId === workspaceId) return;
    await api(`/tasks/${taskId}`, { method: 'PATCH', body: { workspaceId: targetId } });
    onClose();
    onUpdated?.();
  }

  function computeEqualDates(count: number, recType: string, recInterval: number) {
    if (!recType || !task?.dueDate) { setSplitEqualDates([]); return; }
    const base = new Date(task.dueDate.slice(0, 10) + 'T00:00:00');
    const dates: string[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(base);
      if (recType === 'daily') d.setDate(d.getDate() + i * recInterval);
      else if (recType === 'weekly') d.setDate(d.getDate() + i * recInterval * 7);
      else if (recType === 'monthly') d.setMonth(d.getMonth() + i * recInterval);
      dates.push(d.toLocaleDateString('en-CA'));
    }
    setSplitEqualDates(dates);
  }

  async function handleSplit() {
    setSplitting(true);
    try {
      const body: any = { mode: splitMode };
      const recType = splitRecurrence || undefined;
      const recInterval = splitRecurrence ? parseInt(splitRecurrenceInterval) || 1 : undefined;
      if (splitMode === 'equal') {
        body.count = parseInt(splitCount);
        // If recurrence was used, convert to phases mode with auto-generated titles and dates
        if (splitRecurrence && splitEqualDates.length > 0) {
          body.mode = 'phases';
          body.count = undefined;
          const cnt = parseInt(splitCount);
          const perPart = task?.estimatedMinutes ? Math.ceil(task.estimatedMinutes / cnt) : undefined;
          body.phases = splitEqualDates.map((date, i) => ({
            title: `Part ${i + 1}/${cnt}`,
            estimatedMinutes: perPart,
            dueDate: date,
          }));
        }
      } else {
        body.phases = splitPhases.filter(p => p.title.trim()).map(p => ({
          title: p.title,
          estimatedMinutes: p.estimatedMinutes ? parseInt(p.estimatedMinutes) : undefined,
          dueDate: p.dueDate || undefined,
        }));
      }
      // Save recurrence on the parent task if set
      if (recType) {
        await api(`/tasks/${taskId}`, { method: 'PATCH', body: { recurrenceType: recType, recurrenceInterval: recInterval } });
      }
      await api(`/tasks/${taskId}/split`, { method: 'POST', body });
      setShowSplit(false);
      await loadTask();
      onUpdated?.();
    } catch { /* ignore */ }
    setSplitting(false);
  }

  async function handleToggleSegment(segId: string, currentStatus: string) {
    const newStatus = currentStatus === 'done' ? 'pending' : 'done';
    await api(`/task-segments/${segId}`, { method: 'PATCH', body: { status: newStatus } });
    await loadTask();
    onUpdated?.();
  }

  async function handleUpdateSegmentDate(segId: string, dueDate: string) {
    await api(`/task-segments/${segId}`, { method: 'PATCH', body: { dueDate: dueDate || null } });
    await loadTask();
  }

  async function handleRemoveSegments() {
    if (!confirm('Remove all segments? The parent intention will remain.')) return;
    await api(`/tasks/${taskId}/segments`, { method: 'DELETE' });
    await loadTask();
    onUpdated?.();
  }

  if (!task) return (
    <div className="fixed inset-0 z-50 flex justify-end z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={onClose}>
      <div className="w-[480px] h-full p-6 z-animate-in" style={{ background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div className="animate-pulse" style={{ color: 'var(--ink-text-faint)' }}>Loading…</div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end z-animate-fade" style={{ background: 'var(--ink-overlay)' }} onClick={onClose}>
      <div
        className="w-[480px] h-full overflow-y-auto z-animate-in"
        style={{ background: 'var(--ink-surface)', boxShadow: 'var(--ink-shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="z-label" style={{ color: statusLabels[task.status] ? 'var(--ink-text-secondary)' : undefined }}>{statusLabels[task.status] || task.status}</span>
              <span style={{ color: 'var(--ink-border-subtle)', fontSize: '0.75rem' }}>·</span>
              <span className="z-label" style={{ color: task.priority === 'critical' ? 'var(--ink-blocked)' : task.priority === 'high' ? 'var(--ink-accent)' : 'var(--ink-text-faint)' }}>{priorityLabels[task.priority] || task.priority}</span>
            </div>
            <button onClick={onClose} className="z-btn-icon" style={{ color: 'var(--ink-text-faint)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
            </button>
          </div>

          {/* Edit form / display */}
          {editing ? (
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="z-label block mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="z-input"
                  required
                />
              </div>
              <div>
                <label className="z-label block mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="z-input"
                  rows={3}
                  placeholder="Optional"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="z-label block mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="z-select">
                    {statuses.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="z-label block mb-1">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="z-select">
                    {priorities.map(p => <option key={p} value={p}>{priorityLabels[p]}</option>)}
                  </select>
                </div>
              </div>
              {form.status === 'blocked' && (
                <div>
                  <label className="z-label block mb-1">Waiting on what?</label>
                  <input
                    value={form.blockedReason}
                    onChange={(e) => setForm({ ...form, blockedReason: e.target.value })}
                    placeholder="What are you waiting on?"
                    required
                    className="z-input"
                  />
                </div>
              )}
              <div>
                <label className="z-label block mb-1">Due date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="z-input"
                />
              </div>
              <div>
                <label className="z-label block mb-1">Time estimate (minutes)</label>
                <input
                  type="number"
                  value={form.estimatedMinutes}
                  onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })}
                  placeholder="e.g. 30"
                  min="1"
                  max="480"
                  className="z-input"
                />
              </div>
              <div>
                <label className="z-label block mb-1">Complexity</label>
                <div className="flex gap-2">
                  {[{ v: '1', l: 'Simple' }, { v: '2', l: 'Moderate' }, { v: '3', l: 'Complex' }].map(({ v, l }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm({ ...form, complexity: v })}
                      className="flex-1 text-xs py-2 rounded-md transition-all"
                      style={{
                        border: `1.5px solid ${form.complexity === v ? 'var(--ink-accent)' : 'var(--ink-border-subtle)'}`,
                        background: form.complexity === v ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                        color: form.complexity === v ? 'var(--ink-accent)' : 'var(--ink-text-faint)',
                        fontWeight: form.complexity === v ? 600 : 400,
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="z-label block mb-1">Assignee</label>
                <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} className="z-select">
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" className="z-btn z-btn-primary">Save</button>
                <button type="button" onClick={() => setEditing(false)} className="z-btn">Cancel</button>
              </div>
            </form>
          ) : (
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ letterSpacing: '-0.01em' }}>{task.title}</h2>
              {task.description && <p className="z-body mb-3" style={{ color: 'var(--ink-text-secondary)' }}>{task.description}</p>}
              {task.estimatedMinutes && (
                <p className="z-caption mb-3">{task.estimatedMinutes} min estimated · {['Simple', 'Moderate', 'Complex'][(task.complexity ?? 1) - 1]}</p>
              )}
              {task.blockedReason && (
                <p className="text-sm px-3 py-2 rounded-lg mb-3" style={{ background: 'color-mix(in srgb, var(--ink-blocked) 8%, transparent)', color: 'var(--ink-blocked)' }}>{task.blockedReason}</p>
              )}
              {task.tags && task.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mb-3">
                  {task.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--ink-accent-light)', color: 'var(--ink-text-secondary)' }}>{t}</span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mb-4">
                <button onClick={() => setEditing(true)} className="z-btn z-btn-primary z-btn-sm">Edit</button>
                <button onClick={handleImprove} disabled={loadingSuggestion} className="z-btn z-btn-sm" style={{ borderColor: 'var(--ink-accent)', color: 'var(--ink-accent)' }}>
                  {loadingSuggestion ? 'Thinking…' : 'Improve'}
                </button>
                {!task.hasSegments && (
                  <button onClick={() => setShowSplit(true)} className="z-btn z-btn-sm">
                    Split
                  </button>
                )}
                <button onClick={handleDelete} className="z-btn z-btn-ghost z-btn-sm ml-auto" style={{ color: 'var(--ink-blocked)' }}>Delete</button>
              </div>
              {workspaces.length > 1 && (
                <div className="mb-4">
                  <label className="z-label block mb-1">Move to space</label>
                  <select
                    value={workspaceId}
                    onChange={(e) => handleMoveWorkspace(e.target.value)}
                    className="z-select"
                  >
                    {workspaces.map(w => (
                      <option key={w.id} value={w.id}>{w.name}{w.id === workspaceId ? ' (current)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Segments section */}
              {task.hasSegments && segments.length > 0 ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="z-label">
                      Segments ({task.segmentProgress?.completed ?? 0}/{task.segmentProgress?.total ?? 0} done)
                    </h3>
                    <button onClick={handleRemoveSegments} className="z-btn z-btn-ghost z-btn-sm" style={{ color: 'var(--ink-blocked)' }}>Remove</button>
                  </div>
                  <div className="w-full h-1.5 rounded-full mb-2" style={{ background: 'var(--ink-border)' }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${task.segmentProgress ? (task.segmentProgress.completed / task.segmentProgress.total) * 100 : 0}%`,
                      background: 'var(--ink-accent)',
                    }} />
                  </div>
                  <div className="space-y-1">
                    {segments.map(seg => (
                      <div key={seg.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm" style={{ background: seg.status === 'done' ? 'color-mix(in srgb, var(--ink-accent) 8%, transparent)' : 'transparent' }}>
                        <button
                          onClick={() => handleToggleSegment(seg.id, seg.status)}
                          className="shrink-0 w-4 h-4 rounded border flex items-center justify-center text-xs"
                          style={{
                            borderColor: seg.status === 'done' ? 'var(--ink-accent)' : 'var(--ink-border)',
                            background: seg.status === 'done' ? 'var(--ink-accent)' : 'transparent',
                            color: 'white',
                          }}
                        >
                          {seg.status === 'done' && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none"/></svg>}
                        </button>
                        <span className="flex-1" style={{ textDecoration: seg.status === 'done' ? 'line-through' : 'none', color: seg.status === 'done' ? 'var(--ink-text-muted)' : 'inherit' }}>
                          {seg.title.replace(`${task.title} — `, '')}
                        </span>
                        <input
                          type="date"
                          value={seg.dueDate ? seg.dueDate.slice(0, 10) : ''}
                          onChange={(e) => handleUpdateSegmentDate(seg.id, e.target.value)}
                          className="w-28 px-1 py-0.5 rounded text-xs"
                          style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text-muted)' }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {seg.estimatedMinutes && (
                          <span className="text-xs shrink-0" style={{ color: 'var(--ink-text-muted)' }}>{seg.estimatedMinutes}m</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : !task.hasSegments && showSplit && (
                <div className="mb-4">
                    <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--ink-border)' }}>
                      <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-text-muted)' }}>Split into segments</h3>
                      <div className="flex gap-2">
                        {(['equal', 'phases'] as const).map(m => (
                          <button key={m} type="button" onClick={() => setSplitMode(m)} className="flex-1 text-xs py-1.5 rounded-md" style={{
                            border: `1.5px solid ${splitMode === m ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                            background: splitMode === m ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                            color: splitMode === m ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                          }}>
                            {m === 'equal' ? 'Equal parts' : 'Named phases'}
                          </button>
                        ))}
                      </div>
                      <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Repeat</label>
                        <div className="flex gap-1">
                          <select value={splitRecurrence} onChange={(e) => { setSplitRecurrence(e.target.value); if (splitMode === 'equal') computeEqualDates(parseInt(splitCount) || 2, e.target.value, parseInt(splitRecurrenceInterval) || 1); if (splitMode === 'phases' && e.target.value && task?.dueDate) { const base = new Date(task.dueDate.slice(0,10)+'T00:00:00'); const interval = parseInt(splitRecurrenceInterval)||1; setSplitPhases(prev => prev.map((p,i) => { const d = new Date(base); if(e.target.value==='daily') d.setDate(d.getDate()+i*interval); else if(e.target.value==='weekly') d.setDate(d.getDate()+i*interval*7); else if(e.target.value==='monthly') d.setMonth(d.getMonth()+i*interval); return {...p, dueDate: d.toLocaleDateString('en-CA')}; })); } }} className="flex-1 px-2 py-1.5 rounded text-xs" style={{ border: '1px solid var(--ink-border)' }}>
                            <option value="">None</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                          {splitRecurrence && (
                            <input type="number" value={splitRecurrenceInterval} onChange={(e) => { setSplitRecurrenceInterval(e.target.value); if (splitMode === 'equal') computeEqualDates(parseInt(splitCount) || 2, splitRecurrence, parseInt(e.target.value) || 1); }} min="1" max="365" className="w-14 px-2 py-1.5 rounded text-xs" style={{ border: '1px solid var(--ink-border)' }} />
                          )}
                        </div>
                      </div>
                      {splitMode === 'equal' ? (
                        <div className="space-y-1">
                          <input type="number" value={splitCount} onChange={e => { setSplitCount(e.target.value); computeEqualDates(parseInt(e.target.value) || 2, splitRecurrence, parseInt(splitRecurrenceInterval) || 1); }} min="2" max="20" className="w-full px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }} placeholder="Number of parts" />
                          {splitEqualDates.length > 0 && (
                            <div className="space-y-1">
                              {splitEqualDates.map((d, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <span style={{ color: 'var(--ink-text-muted)' }}>Part {i + 1}</span>
                                  <input type="date" value={d} onChange={e => { const u = [...splitEqualDates]; u[i] = e.target.value; setSplitEqualDates(u); }} className="flex-1 px-2 py-1 rounded text-xs" style={{ border: '1px solid var(--ink-border)' }} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {splitPhases.map((p, i) => (
                            <div key={i} className="flex gap-1">
                              <input value={p.title} onChange={e => { const u = [...splitPhases]; u[i] = { ...u[i], title: e.target.value }; setSplitPhases(u); }} placeholder={`Phase ${i + 1}`} className="flex-1 px-2 py-1.5 rounded text-xs" style={{ border: '1px solid var(--ink-border)' }} />
                              <input type="number" value={p.estimatedMinutes} onChange={e => { const u = [...splitPhases]; u[i] = { ...u[i], estimatedMinutes: e.target.value }; setSplitPhases(u); }} placeholder="min" className="w-16 px-2 py-1.5 rounded text-xs" style={{ border: '1px solid var(--ink-border)' }} />
                              <input type="date" value={p.dueDate} onChange={e => { const u = [...splitPhases]; u[i] = { ...u[i], dueDate: e.target.value }; setSplitPhases(u); }} className="w-32 px-2 py-1.5 rounded text-xs" style={{ border: '1px solid var(--ink-border)' }} title="Due date for this phase" />
                              {splitPhases.length > 2 && (
                                <button type="button" onClick={() => setSplitPhases(splitPhases.filter((_, j) => j !== i))} className="text-xs px-1" style={{ color: 'var(--ink-blocked)' }}>×</button>
                              )}
                            </div>
                          ))}
                          <button type="button" onClick={() => setSplitPhases([...splitPhases, { title: '', estimatedMinutes: '', dueDate: '' }])} className="text-xs" style={{ color: 'var(--ink-accent)' }}>+ Add phase</button>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={handleSplit} disabled={splitting} className="px-3 py-1.5 rounded-lg text-xs text-white" style={{ background: 'var(--ink-accent)' }}>
                          {splitting ? 'Splitting…' : 'Split'}
                        </button>
                        <button onClick={() => setShowSplit(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--ink-border)' }}>Cancel</button>
                      </div>
                    </div>
                </div>
              )}
            </div>
          )}

          {/* AI suggestion */}
          {suggestion && (
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--ink-accent)' + '10', border: '1px solid var(--ink-accent-light)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-accent)' }}>AI Suggestion</h3>
              {suggestion.suggestedTitle && <p className="text-sm"><strong>Title:</strong> {suggestion.suggestedTitle}</p>}
              {suggestion.suggestedDescription && <p className="text-sm"><strong>Description:</strong> {suggestion.suggestedDescription}</p>}
              {suggestion.suggestedPriority && <p className="text-sm"><strong>Priority:</strong> {suggestion.suggestedPriority}</p>}
              <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>{suggestion.reasoning}</p>
              {suggestion.similarTasks && suggestion.similarTasks.length > 0 && (
                <div>
                  <p className="text-xs font-medium mt-2">Similar tasks:</p>
                  {suggestion.similarTasks.map(st => (
                    <p key={st.id} className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>• {st.title} ({Math.round(st.similarity * 100)}%)</p>
                  ))}
                </div>
              )}
              <button onClick={() => setSuggestion(null)} className="text-xs underline" style={{ color: 'var(--ink-text-muted)' }}>Dismiss</button>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-4" style={{ borderBottom: '1px solid var(--ink-border-subtle)' }}>
            <button onClick={() => setTab('comments')} className="pb-2 text-[13px] font-medium transition-colors" style={{ borderBottom: tab === 'comments' ? '2px solid var(--ink-accent)' : '2px solid transparent', color: tab === 'comments' ? 'var(--ink-accent)' : 'var(--ink-text-faint)' }}>Comments</button>
            <button onClick={() => setTab('activity')} className="pb-2 text-[13px] font-medium transition-colors" style={{ borderBottom: tab === 'activity' ? '2px solid var(--ink-accent)' : '2px solid transparent', color: tab === 'activity' ? 'var(--ink-accent)' : 'var(--ink-text-faint)' }}>Activity</button>
          </div>

          {tab === 'comments' && (
            <div className="space-y-3">
              <form onSubmit={handleAddComment} className="flex gap-2">
                <input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment…"
                  className="z-input flex-1"
                />
                <button type="submit" className="z-btn z-btn-primary z-btn-sm">Post</button>
              </form>
              {comments.map(c => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{c.author.name}</span>{' '}
                  <span style={{ color: 'var(--ink-text-muted)' }}>{new Date(c.createdAt).toLocaleString()}</span>
                  <p className="mt-0.5">{c.body}</p>
                </div>
              ))}
              {comments.length === 0 && <p className="z-caption">No comments yet.</p>}
            </div>
          )}

          {tab === 'activity' && (
            <div className="space-y-2">
              {activities.map(a => (
                <div key={a.id} className="text-sm flex gap-2">
                  <span className="font-medium shrink-0">{a.actionType.replace(/_/g, ' ')}</span>
                  <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--ink-text-muted)' }}>{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
              {activities.length === 0 && <p className="z-caption">No activity yet.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
