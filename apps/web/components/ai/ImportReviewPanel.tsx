'use client';

import { useState } from 'react';
import PriorityBadge from '../tasks/PriorityBadge';
import StatusChip from '../tasks/StatusChip';

interface DraftItem {
  id: string;
  title: string;
  suggestedStatus: string;
  suggestedPriority: string;
  confidence: number;
  ambiguityNote?: string;
  sourceSnippet?: string;
}

interface Workspace {
  id: string;
  name: string;
}

interface Props {
  items: DraftItem[];
  workspaces: Workspace[];
  currentWorkspaceId: string;
  onAccept: (acceptedIds: string[], targetWorkspaceId: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ImportReviewPanel({ items, workspaces, currentWorkspaceId, onAccept, onCancel, loading }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(items.map(i => i.id)));
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(currentWorkspaceId);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectAll() {
    setSelected(new Set(items.map(i => i.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Review Draft Intentions</h3>
        <div className="flex gap-2 text-xs">
          <button onClick={selectAll} className="underline" style={{ color: 'var(--ink-accent)' }}>Select all</button>
          <button onClick={selectNone} className="underline" style={{ color: 'var(--ink-text-muted)' }}>None</button>
        </div>
      </div>
      <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
        {selected.size} of {items.length} items selected for import
      </p>

      {workspaces.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-1">Import to space</label>
          <select
            value={targetWorkspaceId}
            onChange={(e) => setTargetWorkspaceId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-bg)' }}
          >
            {workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors"
            style={{
              background: selected.has(item.id) ? 'var(--ink-accent)' + '08' : 'var(--ink-surface)',
              border: `1px solid ${selected.has(item.id) ? 'var(--ink-accent-light)' : 'var(--ink-border)'}`,
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
              className="mt-1 accent-[var(--ink-accent)]"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{item.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusChip status={item.suggestedStatus} small />
                <PriorityBadge priority={item.suggestedPriority} />
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: item.confidence >= 0.8 ? 'var(--ink-done)' + '20' : item.confidence >= 0.5 ? 'var(--ink-pending)' + '20' : 'var(--ink-blocked)' + '20',
                    color: item.confidence >= 0.8 ? 'var(--ink-done)' : item.confidence >= 0.5 ? '#b8860b' : 'var(--ink-blocked)',
                  }}
                >
                  {Math.round(item.confidence * 100)}% confidence
                </span>
              </div>
              {item.ambiguityNote && (
                <p className="text-xs mt-1" style={{ color: 'var(--ink-blocked)' }}>{item.ambiguityNote}</p>
              )}
              {item.sourceSnippet && (
                <p className="text-xs mt-1 italic" style={{ color: 'var(--ink-text-muted)' }}>"{item.sourceSnippet}"</p>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }}>Cancel</button>
        <button
          onClick={() => onAccept(Array.from(selected), targetWorkspaceId)}
          disabled={selected.size === 0 || loading}
          className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50"
          style={{ background: 'var(--ink-accent)' }}
        >
          {loading ? 'Importing…' : `Import ${selected.size} task${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
