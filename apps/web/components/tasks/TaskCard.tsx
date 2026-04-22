'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

export interface TaskData {
  id: string;
  title: string;
  status: string;
  priority: string;
  description?: string;
  dueDate?: string;
  assignee?: { id: string; name: string } | null;
  blockedReason?: string;
  tags?: string[];
  hasSegments?: boolean;
  segmentProgress?: { completed: number; total: number } | null;
}

interface Props {
  task: TaskData;
  onClick?: () => void;
  onToggleDone?: (taskId: string) => void;
  onToggleSelect?: (taskId: string) => void;
  selected?: boolean;
  isDragOverlay?: boolean;
  /** When true, visually dim this card (e.g. it's part of a multi-drag selection). */
  dimmed?: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TaskCard({ task, onClick, onToggleDone, onToggleSelect, selected, isDragOverlay, dimmed }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const isDone = task.status === 'done';
  const dueParts = task.dueDate?.slice(0, 10);
  const todayStr = new Date().toLocaleDateString('en-CA');
  const isOverdue = !isDone && dueParts && dueParts < todayStr;
  const showPriority = task.priority === 'high' || task.priority === 'critical';

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging || dimmed ? 0.3 : 1,
    ...(isDragOverlay ? { background: 'var(--ink-surface)', boxShadow: '0 4px 16px rgba(0,0,0,0.10)', borderRadius: '8px', padding: '12px 14px' } : {}),
    ...(selected ? { outline: '2px solid var(--ink-accent, #3b82f6)', outlineOffset: '-2px', borderRadius: '8px' } : {}),
  };

  const meta: string[] = [];
  if (dueParts) meta.push(formatDate(dueParts));
  if (showPriority) meta.push(task.priority === 'critical' ? 'Critical' : 'High');

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="task-item group"
      style={style}
    >
      {/* Checkbox */}
      <button
        className="task-checkbox"
        data-checked={isDone}
        onClick={(e) => { e.stopPropagation(); onToggleDone?.(task.id); }}
        aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
      >
        {isDone && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 5.5L4 8L8.5 2" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={(e) => {
          if (onToggleSelect) {
            e.stopPropagation();
            onToggleSelect(task.id);
            return;
          }
          onClick?.();
        }}
      >
        <span className={`task-title ${isDone ? 'task-done' : ''}`}>
          {task.title}
        </span>
        {(meta.length > 0 || (task.blockedReason && task.status === 'blocked')) && (
          <div className="task-meta">
            {meta.map((m, i) => (
              <span
                key={m}
                className={
                  m === 'Critical' ? 'task-meta-critical' :
                  m === 'High' ? 'task-meta-high' :
                  isOverdue && i === 0 ? 'task-meta-overdue' : ''
                }
              >
                {isOverdue && i === 0 ? `Carried over · ${m}` : m}
              </span>
            ))}
            {task.blockedReason && task.status === 'blocked' && (
              <span className="task-meta-blocked">Blocked: {task.blockedReason}</span>
            )}
          </div>
        )}
        {task.hasSegments && task.segmentProgress && (
          <div className="task-progress">
            <div className="task-progress-bar">
              <div className="task-progress-fill" style={{ width: `${(task.segmentProgress.completed / task.segmentProgress.total) * 100}%` }} />
            </div>
            <span className="task-progress-text">{task.segmentProgress.completed}/{task.segmentProgress.total}</span>
          </div>
        )}
      </div>
    </div>
  );
}
