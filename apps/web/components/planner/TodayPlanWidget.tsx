'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface PlanBlock {
  start: string;
  end: string;
  type: string;
  tasks: string[];
}

interface GoalLike {
  title: string;
  status: string;
  linkedTask?: { status: string } | null;
}

interface TodayPlanWidgetProps {
  blocks: PlanBlock[] | null;
  date: string;
  onRebuild: () => void;
  /** Planner goals used to determine which tasks are actually done. */
  goals?: GoalLike[];
}

const TYPE_STYLES: Record<string, { bg: string; label: string; icon: string; barColor: string }> = {
  focus:  { bg: 'color-mix(in srgb, var(--ink-accent) 10%, transparent)', label: 'Focus',         icon: '', barColor: 'var(--ink-accent)' },
  quick:  { bg: 'color-mix(in srgb, var(--ink-medium) 10%, transparent)', label: 'Quick Intentions',   icon: '', barColor: 'var(--ink-medium)' },
  call:   { bg: 'color-mix(in srgb, var(--ink-in-progress) 10%, transparent)', label: 'Call / Meeting', icon: '', barColor: 'var(--ink-in-progress)' },
  break:  { bg: 'color-mix(in srgb, var(--ink-done) 6%, transparent)',    label: 'Break',          icon: '', barColor: 'var(--ink-done)' },
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isToday(date: string): boolean {
  return date === new Date().toLocaleDateString('en-CA');
}

export default function TodayPlanWidget({ blocks, date, onRebuild, goals = [] }: TodayPlanWidgetProps) {
  const [currentMinute, setCurrentMinute] = useState(nowMinutes());
  const today = isToday(date);
  const router = useRouter();

  // Build a set of task titles that are actually completed. A goal is done
  // when its own status is 'done' OR its linked task is 'done'. Strip the
  // optional "[HH:MM] " prefix the planner sometimes adds to goal titles.
  const doneTitles = new Set(
    goals
      .filter((g) => g.status === 'done' || g.linkedTask?.status === 'done')
      .map((g) => g.title.replace(/^\[\d{2}:\d{2}\]\s*/, '').trim())
  );

  // Update current time every 30 seconds so the active block highlight stays fresh
  useEffect(() => {
    if (!today) return;
    const id = setInterval(() => setCurrentMinute(nowMinutes()), 30_000);
    return () => clearInterval(id);
  }, [today]);

  if (!blocks || blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center gap-3">
        <div className="text-2xl">Flow</div>
        <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          Nothing shaped yet for this day
        </p>
        <button
          onClick={onRebuild}
          className="text-[11px] px-3 py-1.5 rounded-md transition-colors hover:opacity-80 flex items-center gap-1"
          style={{
            color: 'var(--ink-accent)',
            background: 'color-mix(in srgb, var(--ink-accent) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--ink-accent) 30%, transparent)',
          }}
        >
          Shape my flow
        </button>
      </div>
    );
  }

  // Find the range for the progress indicator
  const planStart = timeToMinutes(blocks[0].start);
  const planEnd = timeToMinutes(blocks[blocks.length - 1].end);
  const totalSpan = planEnd - planStart || 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
            Today&apos;s flow
          </span>
          {today && currentMinute >= planStart && currentMinute <= planEnd && (
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--ink-done)' }}
              title="Live"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRebuild}
            className="z-btn z-btn-primary z-btn-xs"
          >
            re-tune
          </button>
        </div>
      </div>

      {/* Progress bar — only shown for today */}
      {today && (
        <div className="w-full h-1 rounded-full mb-2.5 overflow-hidden" style={{ background: 'color-mix(in srgb, var(--ink-border) 30%, transparent)' }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${Math.min(100, Math.max(0, ((currentMinute - planStart) / totalSpan) * 100))}%`,
              background: 'var(--ink-accent)',
            }}
          />
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {blocks.map((block, i) => {
          const style = TYPE_STYLES[block.type] || TYPE_STYLES.focus;
          const blockStart = timeToMinutes(block.start);
          const blockEnd = timeToMinutes(block.end);
          const isActive = today && currentMinute >= blockStart && currentMinute < blockEnd;
          // A block is "truly done" only when every one of its tasks is marked
          // done in the goals list. Time passing alone does NOT make a task done.
          const blockTasksDone = block.tasks.length > 0 && block.tasks.every((t) => doneTitles.has(t.trim()));
          const isBlockDone = block.type !== 'break' && blockTasksDone;

          return (
            <div
              key={i}
              className="flex items-stretch gap-2 transition-all duration-200"
              style={{ opacity: isBlockDone ? 0.6 : 1 }}
            >
              {/* Time column */}
              <div className="w-11 shrink-0 text-right pt-1.5">
                <p
                  className="text-[10px] font-mono leading-tight"
                  style={{
                    color: isActive ? 'var(--ink-accent)' : 'var(--ink-text)',
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  {block.start}
                </p>
                <p className="text-[8px] font-mono" style={{ color: 'var(--ink-text-muted)' }}>
                  {block.end}
                </p>
              </div>

              {/* Color bar + active pulse */}
              <div className="relative flex flex-col items-center" style={{ width: '6px' }}>
                <div
                  className="w-1 flex-1 rounded-full"
                  style={{
                    background: style.barColor,
                    opacity: block.type === 'break' ? 0.3 : isBlockDone ? 0.3 : 0.7,
                  }}
                />
                {isActive && (
                  <div
                    className="absolute w-2.5 h-2.5 rounded-full animate-pulse"
                    style={{
                      background: style.barColor,
                      top: '6px',
                      boxShadow: `0 0 6px ${style.barColor}`,
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div
                className="flex-1 rounded-md px-2.5 py-1.5 mb-0.5 transition-all duration-200"
                style={{
                  background: isActive
                    ? `color-mix(in srgb, var(--ink-accent) 12%, transparent)`
                    : style.bg,
                  border: isActive
                    ? '1px solid color-mix(in srgb, var(--ink-accent) 40%, transparent)'
                    : '1px solid color-mix(in srgb, var(--ink-border) 20%, transparent)',
                }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: style.barColor, opacity: 0.85 }}>
                    {style.icon} {style.label}
                  </span>
                  {isActive && (
                    <span
                      className="text-[7px] px-1 py-px rounded-full font-semibold uppercase tracking-wider"
                      style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)' }}
                    >
                      now
                    </span>
                  )}
                  {isBlockDone && (
                    <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="var(--ink-text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 6 5 9 10 3"/></svg>
                  )}
                </div>
                <div className="space-y-px">
                  {block.tasks.map((task, j) => {
                    const taskDone = block.type !== 'break' && doneTitles.has(task.trim());
                    return (
                      <p
                        key={j}
                        className="text-[11px] leading-snug"
                        style={{
                          color: block.type === 'break'
                            ? 'var(--ink-text-muted)'
                            : taskDone
                              ? 'var(--ink-text-muted)'
                              : 'var(--ink-text)',
                          textDecoration: taskDone ? 'line-through' : 'none',
                        }}
                      >
                        {task}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer summary */}
      <div className="flex items-center justify-between mt-2 pt-1.5" style={{ borderTop: '1px solid color-mix(in srgb, var(--ink-border) 25%, transparent)' }}>
        <span className="text-[9px]" style={{ color: 'var(--ink-text-muted)' }}>
          {blocks.filter(b => b.type !== 'break').length} blocks · {blocks[0].start}–{blocks[blocks.length - 1].end}
        </span>
        {today && (() => {
          const activeIdx = blocks.findIndex(b => {
            const s = timeToMinutes(b.start);
            const e = timeToMinutes(b.end);
            return currentMinute >= s && currentMinute < e;
          });
          if (activeIdx >= 0 && blocks[activeIdx].type !== 'break') {
            const remaining = timeToMinutes(blocks[activeIdx].end) - currentMinute;
            return (
              <span className="text-[9px] font-medium" style={{ color: 'var(--ink-accent)' }}>
                {remaining}m left in block
              </span>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}
