'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

interface Props {
  workspaceId: string;
  onCreated: () => void;
  onCancel: () => void;
}

const priorities = ['low', 'medium', 'high', 'critical'];
const priorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export default function CreateTaskForm({ workspaceId, onCreated, onCancel }: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [complexity, setComplexity] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await api(`/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      body: {
        title,
        description: description || undefined,
        priority,
        status: 'pending',
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes) : undefined,
        complexity: parseInt(complexity) || 1,
        assigneeId: user?.id || undefined,
      },
    });
    setSubmitting(false);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.2)' }} onClick={onCancel}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl p-6 space-y-4 shadow-lg"
        style={{ background: 'var(--ink-surface)' }}
      >
        <h2 className="text-lg font-semibold">New Intention</h2>
        {/* 1. Title */}
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            required
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)' }}
            autoFocus
          />
        </div>
        {/* 2. Description */}
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)' }}
            rows={3}
          />
        </div>
        {/* 3. Priority */}
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)' }}
          >
            {priorities.map(p => <option key={p} value={p}>{priorityLabels[p]}</option>)}
          </select>
        </div>
        {/* 4. Due Date */}
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Due date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)' }}
          />
        </div>
        {/* 5. Time Estimate */}
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Time estimate (minutes)</label>
          <input
            type="number"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            placeholder="e.g. 30"
            min="1"
            max="480"
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)' }}
          />
        </div>
        {/* 6. Complexity */}
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--ink-text-muted)' }}>Complexity</label>
          <div className="flex gap-2">
            {[{ v: '1', l: 'Simple' }, { v: '2', l: 'Moderate' }, { v: '3', l: 'Complex' }].map(({ v, l }) => (
              <button
                key={v}
                type="button"
                onClick={() => setComplexity(v)}
                className="flex-1 text-xs py-2 rounded-md transition-all"
                style={{
                  border: `1.5px solid ${complexity === v ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                  background: complexity === v ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                  color: complexity === v ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                  fontWeight: complexity === v ? 600 : 400,
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }}>Cancel</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50" style={{ background: 'var(--ink-accent)' }}>
            {submitting ? 'Creating…' : 'Create Intention'}
          </button>
        </div>
      </form>
    </div>
  );
}
