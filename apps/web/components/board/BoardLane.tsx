'use client';

import { useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import TaskCard, { type TaskData } from '../tasks/TaskCard';

interface Props {
  title: string;
  status: string;
  tasks: TaskData[];
  color: string;
  onTaskClick: (taskId: string) => void;
  onToggleDone?: (taskId: string) => void;
  onQuickAdd?: (title: string) => Promise<void>;
  onToggleSelect?: (taskId: string) => void;
  selectedIds?: Set<string>;
  /** Task ids to visually dim (e.g. multi-drag siblings). */
  dimmedIds?: Set<string>;
  mobile?: boolean;
}

export default function BoardLane({ title, status, tasks, color, onTaskClick, onToggleDone, onQuickAdd, onToggleSelect, selectedIds, dimmedIds, mobile }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [quickTitle, setQuickTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const quickInputRef = useRef<HTMLInputElement | null>(null);

  const tintMap: Record<string, string> = {
    pending: 'rgba(245, 158, 11, 0.04)',
    in_progress: 'rgba(59, 130, 246, 0.04)',
    blocked: 'rgba(239, 68, 68, 0.04)',
    done: 'rgba(16, 185, 129, 0.04)',
  };

  const accentMap: Record<string, string> = {
    pending: '#f59e0b',
    in_progress: '#3b82f6',
    blocked: '#ef4444',
    done: '#10b981',
  };

  const accent = accentMap[status] ?? color;
  const tint = tintMap[status] ?? 'transparent';

  return (
    <div
      className={mobile ? 'flex flex-col w-full' : 'flex flex-col min-w-[280px] max-w-[320px] w-full'}
      style={{
        background: tint,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Top accent bar */}
      <div style={{ height: 3, background: accent, borderRadius: '8px 8px 0 0' }} />

      {!mobile && (
        <div className="flex items-center gap-2 mb-3 px-1" style={{ paddingTop: '10px' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: accent }} />
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
            {title}
          </h3>
          <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            {tasks.length}
          </span>
        </div>
      )}
      <div
        ref={setNodeRef}
        className="board-lane-drop"
        style={{
          background: isOver ? 'var(--ink-surface-hover)' : 'transparent',
          outline: isOver ? `1px dashed var(--ink-border)` : 'none',
        }}
        data-status={status}
      >
        {onQuickAdd && (
          <div className="px-1 pb-2">
            <input
              ref={quickInputRef}
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && quickTitle.trim() && !adding) {
                  e.preventDefault();
                  setAdding(true);
                  try {
                    await onQuickAdd(quickTitle.trim());
                    setQuickTitle('');
                  } finally {
                    setAdding(false);
                    // Restore focus so the user can keep typing next intentions
                    // without reaching for the mouse.
                    requestAnimationFrame(() => quickInputRef.current?.focus());
                  }
                }
              }}
              placeholder="+ Add intention…"
              readOnly={adding}
              className="w-full text-xs bg-transparent outline-none px-2.5 py-2 rounded-lg"
              style={{ color: 'var(--ink-text)', border: '1px dashed var(--ink-border-subtle)', opacity: adding ? 0.5 : 1 }}
            />
          </div>
        )}
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick(task.id)}
            onToggleDone={onToggleDone}
            onToggleSelect={onToggleSelect}
            selected={selectedIds?.has(task.id)}
            dimmed={dimmedIds?.has(task.id)}
          />
        ))}
        {tasks.length === 0 && (
          <p className="text-center text-xs py-8" style={{ color: 'var(--ink-text-muted)', opacity: 0.5 }}>
            No tasks
          </p>
        )}
      </div>
    </div>
  );
}
