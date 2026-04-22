'use client';

import { useState, useCallback } from 'react';
import {
  useWorkingSession,
  formatTime,
  formatDate,
  timeToMinutes,
} from '@/lib/useWorkingSession';

interface MiniWorkingModeProps {
  /** The date (YYYY-MM-DD) to show tasks for */
  date: string;
  /** Optional callback when user wants to return to full mode */
  onOpenFullMode?: () => void;
  /** If true, renders in standalone mode (for popup windows) */
  standalone?: boolean;
}

/**
 * Mirrors the full Working Mode layout: current block with checkboxes,
 * next block preview, later blocks summary, and progress footer.
 */
export default function MiniWorkingMode({
  date,
  onOpenFullMode,
  standalone = false,
}: MiniWorkingModeProps) {
  const { state, derived, actions, animatingTask } = useWorkingSession(date, true);
  const { completedTasks, loaded, blocks } = state;
  const { activeBlock, nextWorkBlock, minutesLeft, workBlocks, completedBlockCount, isBlockComplete, allTasks } = derived;

  // Day wrap-up state
  const [dayEnded, setDayEnded] = useState(false);
  const [endDaySummary, setEndDaySummary] = useState<{ completedCount: number; movedBackCount: number } | null>(null);

  const handleToggleTask = useCallback(async (taskTitle: string) => {
    await actions.toggleTask(taskTitle);
  }, [actions]);

  const handleEndDay = useCallback(async () => {
    const uncompleted = allTasks.filter(t => !completedTasks.has(t)).length;
    if (uncompleted > 0) {
      const confirmed = window.confirm(
        `${uncompleted} task${uncompleted > 1 ? 's were' : ' was'} not completed.\nMove back to backlog?`
      );
      if (!confirmed) return;
    }
    const summary = await actions.endDay();
    setEndDaySummary(summary);
    setDayEnded(true);
  }, [allTasks, completedTasks, actions]);

  if (!loaded) {
    return (
      <div className="mini-wm-container mini-wm-standalone">
        <div className="mini-wm-loading">Loading…</div>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="mini-wm-container mini-wm-standalone">
        <div className="mini-wm-empty">
          <p>No plan for today</p>
          {onOpenFullMode && (
            <button onClick={onOpenFullMode} className="mini-wm-link-btn">
              Open Planner
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`mini-wm-container ${standalone ? 'mini-wm-standalone' : ''}`}>
      {/* Header */}
      <header className="mini-wm-header">
        <div className="mini-wm-date">{formatDate(date)}</div>
        <div className="mini-wm-controls">
          {onOpenFullMode && (
            <button onClick={onOpenFullMode} className="wm-icon-btn" title="Open full mode">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 1h6v6M7 15H1V9" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 1L9 7M1 15l6-6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Past blocks (elapsed but still checkable) */}
      {(() => {
        const past = blocks.filter(b =>
          b.type !== 'break' &&
          timeToMinutes(b.end) <= state.currentMinute &&
          b !== activeBlock
        );
        if (past.length === 0) return null;
        return (
          <>
            <section className="mini-wm-later">
              <span className="mini-wm-block-label">Earlier</span>
              {past.map((b, i) => (
                <div key={i} className="mini-wm-later-block">
                  <div className="mini-wm-block-header">
                    <span className="mini-wm-later-time">{formatTime(b.start)}</span>
                  </div>
                  <div className="mini-wm-tasks">
                    {b.tasks.map((task, ti) => {
                      const done = completedTasks.has(task);
                      const isAnimating = animatingTask === task;
                      return (
                        <button
                          key={`${task}-${ti}`}
                          className={`mini-wm-task ${done ? 'mini-wm-task-done' : ''} ${isAnimating ? 'mini-wm-task-animating' : ''}`}
                          onClick={() => handleToggleTask(task)}
                        >
                          <span className={`mini-wm-checkbox ${done ? 'mini-wm-checkbox-checked' : ''}`}>
                            {done && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </span>
                          <span className="mini-wm-task-title">{task}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
            <hr className="mini-wm-divider" />
          </>
        );
      })()}

      {/* Current Block */}
      {activeBlock ? (
        <section className="mini-wm-block">
          <div className="mini-wm-block-header">
            <span className="mini-wm-block-label">Now</span>
            <span className="mini-wm-time">
              {formatTime(activeBlock.start)} – {formatTime(activeBlock.end)}
            </span>
            <span className="mini-wm-remaining">{minutesLeft}m</span>
          </div>

          {activeBlock.type === 'break' ? (
            <div className="mini-wm-break">Break · {minutesLeft}m left</div>
          ) : (
            <>
              <div className="mini-wm-tasks">
                {activeBlock.tasks.map((task, i) => {
                  const done = completedTasks.has(task);
                  const isAnimating = animatingTask === task;
                  return (
                    <button
                      key={`${task}-${i}`}
                      className={`mini-wm-task ${done ? 'mini-wm-task-done' : ''} ${isAnimating ? 'mini-wm-task-animating' : ''}`}
                      onClick={() => handleToggleTask(task)}
                    >
                      <span className={`mini-wm-checkbox ${done ? 'mini-wm-checkbox-checked' : ''}`}>
                        {done && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                      <span className="mini-wm-task-title">{task}</span>
                    </button>
                  );
                })}
              </div>

              {/* Block completion indicator */}
              {isBlockComplete ? (
                <div className="mini-wm-block-complete">
                  <span className="mini-wm-block-complete-check">✓</span>
                  <span>Block complete</span>
                  {nextWorkBlock && (
                    <button
                      onClick={actions.startNextBlock}
                      className="mini-wm-next-block-btn"
                    >
                      Start next →
                    </button>
                  )}
                </div>
              ) : (
                <p className="mini-wm-minutes-left">{minutesLeft}m remaining</p>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="mini-wm-block">
          <p className="mini-wm-between">
            {state.currentMinute < timeToMinutes(blocks[0].start)
              ? `Your day starts at ${formatTime(blocks[0].start)}`
              : nextWorkBlock
                ? `Next block at ${formatTime(nextWorkBlock.start)}`
                : 'All blocks complete for today'}
          </p>
        </section>
      )}

      {/* Divider */}
      <hr className="mini-wm-divider" />

      {/* Next block preview */}
      {nextWorkBlock && (
        <section className="mini-wm-later">
          <span className="mini-wm-block-label">Next</span>
          <div className="mini-wm-later-block">
            <div className="mini-wm-block-header">
              <span className="mini-wm-later-time">{formatTime(nextWorkBlock.start)}</span>
            </div>
            <div className="mini-wm-tasks">
              {nextWorkBlock.tasks.map((task, i) => {
                const done = completedTasks.has(task);
                const isAnimating = animatingTask === task;
                return (
                  <button
                    key={`${task}-${i}`}
                    className={`mini-wm-task ${done ? 'mini-wm-task-done' : ''} ${isAnimating ? 'mini-wm-task-animating' : ''}`}
                    onClick={() => handleToggleTask(task)}
                  >
                    <span className={`mini-wm-checkbox ${done ? 'mini-wm-checkbox-checked' : ''}`}>
                      {done && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <span className="mini-wm-task-title">{task}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Later blocks */}
      {(() => {
        const remaining = blocks.filter(b =>
          b.type !== 'break' &&
          timeToMinutes(b.start) > state.currentMinute &&
          b !== nextWorkBlock
        );
        if (remaining.length === 0) return null;
        return (
          <>
            <hr className="mini-wm-divider" />
            <section className="mini-wm-later">
              <span className="mini-wm-block-label">Later</span>
              {remaining.map((b, i) => (
                <div key={i} className="mini-wm-later-block">
                  <div className="mini-wm-block-header">
                    <span className="mini-wm-later-time">{formatTime(b.start)}</span>
                  </div>
                  <div className="mini-wm-tasks">
                    {b.tasks.map((task, ti) => {
                      const done = completedTasks.has(task);
                      const isAnimating = animatingTask === task;
                      return (
                        <button
                          key={`${task}-${ti}`}
                          className={`mini-wm-task ${done ? 'mini-wm-task-done' : ''} ${isAnimating ? 'mini-wm-task-animating' : ''}`}
                          onClick={() => handleToggleTask(task)}
                        >
                          <span className={`mini-wm-checkbox ${done ? 'mini-wm-checkbox-checked' : ''}`}>
                            {done && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </span>
                          <span className="mini-wm-task-title">{task}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          </>
        );
      })()}

      {/* Completed execution log */}
      {completedTasks.size > 0 && (
        <>
          <hr className="mini-wm-divider" />
          <section className="mini-wm-completed">
            <span className="mini-wm-block-label">Completed</span>
            <div className="mini-wm-completed-list">
              {allTasks.filter(t => completedTasks.has(t)).map((task, i) => (
                <div key={`done-${task}-${i}`} className="mini-wm-completed-item">
                  <span className="mini-wm-completed-check">✓</span>
                  <span className="mini-wm-task-title">{task}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Progress footer */}
      <footer className="mini-wm-footer">
        <div className="mini-wm-progress-bar">
          <div
            className="mini-wm-progress-fill"
            style={{ width: `${allTasks.length > 0 ? (completedTasks.size / allTasks.length) * 100 : 0}%` }}
          />
        </div>
        <span className="mini-wm-progress-text">
          {completedTasks.size} of {allTasks.length} intentions completed
        </span>
        {!dayEnded ? (
          <button onClick={handleEndDay} className="wm-icon-btn wm-end-day-icon" title="Wrap up day — uncompleted intentions return to backlog">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 15V1" strokeLinecap="round"/>
              <path d="M3 1c3 2 6-1 10 1v6c-4-2-7 1-10-1" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : endDaySummary && (
          <p className="wm-end-day-done">
            {endDaySummary.completedCount} done{endDaySummary.movedBackCount > 0 ? ` · ${endDaySummary.movedBackCount} to backlog` : ''}
          </p>
        )}
      </footer>
    </div>
  );
}
