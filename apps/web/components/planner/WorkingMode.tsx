'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useWorkingSession, formatTime, formatDate, timeToMinutes } from '@/lib/useWorkingSession';
import { useMiniWindow, getMiniWindowStatus } from '@/lib/useMiniWindow';
import { createRoot } from 'react-dom/client';
import MiniWorkingMode from './MiniWorkingMode';

// Detect mobile device
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const check = () => {
      const mobile = window.matchMedia('(max-width: 768px)').matches 
        || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  
  return isMobile;
}

export default function WorkingMode() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const today = searchParams.get('date') || new Date().toLocaleDateString('en-CA');
  const isMobile = useIsMobile();

  // Use the shared session hook
  const { state, derived, actions, animatingTask } = useWorkingSession(today, !!user);
  const { completedTasks, loaded, blocks } = state;
  const { 
    activeBlock, 
    nextWorkBlock, 
    minutesLeft, 
    workBlocks, 
    completedBlockCount, 
    isBlockComplete,
    progressPercent,
    allTasks,
  } = derived;

  // Day wrap-up state
  const [dayEnded, setDayEnded] = useState(false);
  const [endDaySummary, setEndDaySummary] = useState<{ completedCount: number; movedBackCount: number } | null>(null);

  // Track root for PiP window
  const pipRootRef = useRef<ReturnType<typeof createRoot> | null>(null);

  // Mini window hook with render callback
  const miniWindow = useMiniWindow(
    useCallback((container: HTMLElement, onClose: () => void) => {
      // Render MiniWorkingMode in the PiP container
      const root = createRoot(container);
      pipRootRef.current = root;
      root.render(
        <MiniWorkingMode 
          date={today}
          onOpenFullMode={() => {
            onClose();
            // Focus main window
            window.focus();
          }}
        />
      );
    }, [today])
  );

  // Get mini window capability status
  const [windowStatus, setWindowStatus] = useState({ canUsePip: false, canUsePopup: false, message: '' });
  useEffect(() => {
    setWindowStatus(getMiniWindowStatus());
  }, []);

  // Cleanup PiP root on unmount
  useEffect(() => {
    return () => {
      pipRootRef.current?.unmount();
    };
  }, []);

  // Handle detach button click
  const handleDetach = useCallback(async () => {
    await miniWindow.open();
  }, [miniWindow]);

  // Handle wrap up day
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

  if (loading || !loaded) {
    return (
      <div className="wm-container">
        <div className="wm-content">
          <p className="wm-loading">Loading…</p>
        </div>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="wm-container">
        <div className="wm-content" style={{ textAlign: 'center', paddingTop: '20vh' }}>
          <p style={{ fontSize: '1.25rem', color: 'var(--wm-text-muted)', marginBottom: '1rem' }}>
            No plan for today yet
          </p>
          <button
            onClick={() => router.push('/planner')}
            className="wm-exit-btn"
          >
            Go to Planner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wm-container">
      <div className="wm-content">
        {/* Date header */}
        <header className="wm-header">
          <p className="wm-date">{formatDate(today)}</p>
          <div className="wm-header-actions">
            {/* Mini window / detach button (desktop only) */}
            {!isMobile && (windowStatus.canUsePip || windowStatus.canUsePopup) && (
              <button 
                onClick={handleDetach}
                className="wm-icon-btn"
                title="Detach mini window"
                disabled={miniWindow.isOpen}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1" y="5" width="10" height="10" rx="1.5" />
                  <path d="M5 5V2.5A1.5 1.5 0 016.5 1H13.5A1.5 1.5 0 0115 2.5V9.5A1.5 1.5 0 0113.5 11H11" />
                </svg>
              </button>
            )}
            <button onClick={() => router.push('/today')} className="wm-exit-btn">
              Back to Today
            </button>
            <button onClick={() => router.push('/planner')} className="wm-exit-btn">
              Exit
            </button>
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
              <section className="wm-section wm-past-section">
                <span className="wm-section-label">Earlier</span>
                {past.map((b, i) => (
                  <div key={i} className="wm-later-block">
                    <div className="wm-block-header">
                      <span className="wm-later-time">{formatTime(b.start)}</span>
                    </div>
                    <div className="wm-tasks">
                      {b.tasks.map((task, ti) => {
                        const done = completedTasks.has(task);
                        const isAnimating = animatingTask === task;
                        return (
                          <button
                            key={`${task}-${ti}`}
                            className={`wm-task ${done ? 'wm-task-done' : ''} ${isAnimating ? 'wm-task-animating' : ''}`}
                            onClick={() => actions.toggleTask(task)}
                          >
                            <span className={`wm-checkbox ${done ? 'wm-checkbox-checked' : ''}`}>
                              {done && (
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </span>
                            <span className="wm-task-title">{task}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
              <hr className="wm-divider" />
            </>
          );
        })()}

        {/* Current block */}
        {activeBlock ? (
          <section className="wm-section">
            <div className="wm-block-header">
              <span className="wm-section-label">Now</span>
              <span className="wm-time-range">
                {formatTime(activeBlock.start)} – {formatTime(activeBlock.end)}
              </span>
            </div>

            {activeBlock.type === 'break' ? (
              <div className="wm-break">
                <p className="wm-break-text">Break</p>
                <p className="wm-minutes-left">{minutesLeft}m left</p>
              </div>
            ) : (
              <>
                <div className="wm-tasks">
                  {activeBlock.tasks.map((task, i) => {
                    const done = completedTasks.has(task);
                    const isAnimating = animatingTask === task;
                    return (
                      <button
                        key={`${task}-${i}`}
                        className={`wm-task ${done ? 'wm-task-done' : ''} ${isAnimating ? 'wm-task-animating' : ''}`}
                        onClick={() => actions.toggleTask(task)}
                      >
                        <span className={`wm-checkbox ${done ? 'wm-checkbox-checked' : ''}`}>
                          {done && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </span>
                        <span className="wm-task-title">{task}</span>
                      </button>
                    );
                  })}
                </div>
                
                {/* Block completion indicator + action */}
                {isBlockComplete ? (
                  <div className="wm-block-complete">
                    <span className="wm-block-complete-check">✓</span>
                    <span>Block complete</span>
                    {nextWorkBlock && (
                      <button 
                        onClick={actions.startNextBlock}
                        className="wm-next-block-btn"
                      >
                        Start next →
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="wm-minutes-left">{minutesLeft}m remaining</p>
                )}
              </>
            )}
          </section>
        ) : (
          <section className="wm-section">
            <p className="wm-between-blocks">
              {state.currentMinute < timeToMinutes(blocks[0].start)
                ? `Your day starts at ${formatTime(blocks[0].start)}`
                : nextWorkBlock
                  ? `Next block at ${formatTime(nextWorkBlock.start)}`
                  : 'All blocks complete for today'}
            </p>
          </section>
        )}

        {/* Divider */}
        <hr className="wm-divider" />

        {/* Next block preview */}
        {nextWorkBlock && (
          <section className="wm-section wm-next-section">
            <span className="wm-section-label">Next</span>
            <div className="wm-later-block">
              <div className="wm-block-header">
                <span className="wm-later-time">{formatTime(nextWorkBlock.start)}</span>
              </div>
              <div className="wm-tasks">
                {nextWorkBlock.tasks.map((task, i) => {
                  const done = completedTasks.has(task);
                  const isAnimating = animatingTask === task;
                  return (
                    <button
                      key={`${task}-${i}`}
                      className={`wm-task ${done ? 'wm-task-done' : ''} ${isAnimating ? 'wm-task-animating' : ''}`}
                      onClick={() => actions.toggleTask(task)}
                    >
                      <span className={`wm-checkbox ${done ? 'wm-checkbox-checked' : ''}`}>
                        {done && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                      <span className="wm-task-title">{task}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Remaining blocks */}
        {(() => {
          const remaining = blocks.filter(b =>
            b.type !== 'break' &&
            timeToMinutes(b.start) > state.currentMinute &&
            b !== nextWorkBlock
          );
          if (remaining.length === 0) return null;
          return (
            <>
              <hr className="wm-divider" />
              <section className="wm-section wm-later-section">
                <span className="wm-section-label">Later</span>
                {remaining.map((b, i) => (
                  <div key={i} className="wm-later-block">
                    <div className="wm-block-header">
                      <span className="wm-later-time">{formatTime(b.start)}</span>
                    </div>
                    <div className="wm-tasks">
                      {b.tasks.map((task, ti) => {
                        const done = completedTasks.has(task);
                        const isAnimating = animatingTask === task;
                        return (
                          <button
                            key={`${task}-${ti}`}
                            className={`wm-task ${done ? 'wm-task-done' : ''} ${isAnimating ? 'wm-task-animating' : ''}`}
                            onClick={() => actions.toggleTask(task)}
                          >
                            <span className={`wm-checkbox ${done ? 'wm-checkbox-checked' : ''}`}>
                              {done && (
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </span>
                            <span className="wm-task-title">{task}</span>
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
            <hr className="wm-divider" />
            <section className="wm-section wm-completed-section">
              <span className="wm-section-label">Completed</span>
              <div className="wm-completed-list">
                {allTasks.filter(t => completedTasks.has(t)).map((task, i) => (
                  <div key={`done-${task}-${i}`} className="wm-completed-item">
                    <span className="wm-completed-check">✓</span>
                    <span className="wm-completed-title">{task}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* Progress footer */}
        <footer className="wm-footer">
          <div className="wm-progress-bar">
            <div
              className="wm-progress-fill"
              style={{ width: `${allTasks.length > 0 ? (completedTasks.size / allTasks.length) * 100 : 0}%` }}
            />
          </div>
          <p className="wm-progress-text">
            {completedTasks.size} of {allTasks.length} intentions completed
          </p>

          {/* Wrap Up Day */}
          {!dayEnded ? (
            <button onClick={handleEndDay} className="wm-icon-btn wm-end-day-icon" title="Wrap up day — uncompleted intentions return to backlog">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
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
    </div>
  );
}
