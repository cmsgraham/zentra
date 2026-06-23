'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useState } from 'react';
import TaskCard, { type TaskData } from '../tasks/TaskCard';
import QuickAddInput from './QuickAddInput';

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
  /** Map of workspaceId → accent colour. Passed through to each TaskCard so
   *  the cross-workspace "All" board can differentiate tasks visually. */
  accentColorByWorkspace?: Record<string, string>;
  mobile?: boolean;
  /** localStorage key for persisting the user-chosen lane size on mobile. */
  resizeStorageKey?: string;
}

// Discrete sizes are far easier to use on touch than a drag handle (which
// fights iOS long-press / text selection). One tap cycles to the next size.
const MOBILE_LANE_SIZES: { label: string; height: number }[] = [
  { label: 'S', height: 200 },
  { label: 'M', height: 360 },
  { label: 'L', height: 560 },
  { label: 'XL', height: 820 },
];
const MOBILE_LANE_DEFAULT_IDX = 1; // M

export default function BoardLane({ title, status, tasks, color, onTaskClick, onToggleDone, onQuickAdd, onToggleSelect, selectedIds, dimmedIds, accentColorByWorkspace, mobile, resizeStorageKey }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  // ---- Mobile-only lane size (cycle through presets) ----
  const [sizeIdx, setSizeIdx] = useState<number>(MOBILE_LANE_DEFAULT_IDX);
  useEffect(() => {
    if (!mobile || !resizeStorageKey) return;
    try {
      const raw = localStorage.getItem(resizeStorageKey);
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 0 && n < MOBILE_LANE_SIZES.length) {
          setSizeIdx(n);
        }
      }
    } catch {}
  }, [mobile, resizeStorageKey]);
  const laneHeight = MOBILE_LANE_SIZES[sizeIdx].height;
  const sizeLabel = MOBILE_LANE_SIZES[sizeIdx].label;

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
      className={mobile ? 'flex flex-col w-full' : 'flex flex-col min-w-[280px] max-w-[320px] w-full h-full min-h-0'}
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
          ...(mobile
            ? {
                // Override .board-lane-drop's `flex: 1 1 0` so the explicit
                // height below isn't ignored by the flex parent.
                flex: 'none',
                height: laneHeight,
                minHeight: laneHeight,
                maxHeight: laneHeight,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch' as const,
              }
            : {}),
        }}
        data-status={status}
      >
        {onQuickAdd && (
          <div
            className="px-1 pb-2"
            data-tour="quick-add"
            data-tour-label="Quick add — type and press Enter"
          >
            <QuickAddInput onSubmit={onQuickAdd} />
          </div>
        )}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task, idx) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task.id)}
              onToggleDone={onToggleDone}
              onToggleSelect={onToggleSelect}
              selected={selectedIds?.has(task.id)}
              dimmed={dimmedIds?.has(task.id)}
              accentColor={task.workspaceId ? accentColorByWorkspace?.[task.workspaceId] : undefined}
              rowNumber={status === 'done' ? undefined : idx + 1}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="text-center text-xs py-8" style={{ color: 'var(--ink-text-muted)', opacity: 0.5 }}>
            No tasks
          </p>
        )}
      </div>
      {mobile && (
        <div
          className="self-end mr-1 mt-1 mb-1"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            color: 'var(--ink-text-muted)',
            background: 'var(--ink-surface, transparent)',
            border: '1px solid var(--ink-border)',
            borderRadius: 999,
            position: 'relative',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span aria-hidden style={{ opacity: 0.6 }}>↕</span>
          <span>{sizeLabel}</span>
          <select
            aria-label={`Resize ${title} lane`}
            value={sizeIdx}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              if (Number.isFinite(next) && next >= 0 && next < MOBILE_LANE_SIZES.length) {
                setSizeIdx(next);
                if (resizeStorageKey) {
                  try { localStorage.setItem(resizeStorageKey, String(next)); } catch {}
                }
              }
            }}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              width: '100%',
              height: '100%',
              cursor: 'pointer',
              fontSize: 16, // prevents iOS zoom on focus
            }}
          >
            {MOBILE_LANE_SIZES.map((s, i) => (
              <option key={s.label} value={i}>{s.label} — {s.height}px</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
