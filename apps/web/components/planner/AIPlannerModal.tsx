'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import { useFocusStore } from '@/lib/useFocusStore';

interface PlanBlock {
  start: string;
  end: string;
  type: string;
  tasks: string[];
}

interface AIPlannerModalProps {
  date: string;
  onClose: () => void;
  onApplied: () => void;
}

const TYPE_STYLES: Record<string, { bg: string; label: string; icon: string }> = {
  focus: { bg: 'var(--ink-accent)', label: 'Focus', icon: '' },
  quick: { bg: 'var(--ink-medium)', label: 'Quick Intentions', icon: '' },
  call: { bg: 'var(--ink-in-progress)', label: 'Call / Meeting', icon: '' },
  break: { bg: 'var(--ink-done)', label: 'Break', icon: '' },
};

const THINKING_MESSAGES = [
  'Analyzing your intentions...',
  'Checking your calendar...',
  'Optimizing time blocks...',
  'Prioritizing what matters...',
  'Shuffling priorities like a card trick...',
  'Teaching the AI about procrastination...',
  'Almost there, just convincing the robot...',
  'Negotiating with the algorithm...',
  'The robot is deep in thought...',
  'Computing the meaning of productivity...',
];

function RobotAnimation() {
  const [frame, setFrame] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setFrame(f => (f + 1) % 4), 400);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setMsgIndex(m => (m + 1) % THINKING_MESSAGES.length), 3000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const eyes = ['◉ ◉', '◉ ◉', '◑ ◑', '◉ ◉'][frame];
  const mouth = ['───', '═══', '~~~', '═══'][frame];
  const arms = [
    ['╔', '╗'],
    ['╠', '╣'],
    ['╔', '╣'],
    ['╠', '╗'],
  ][frame];
  const sparks = ['*', '*', '*', '*'][frame];

  return (
    <div className="flex flex-col items-center justify-center py-6 select-none">
      <pre
        className="text-center leading-snug mb-4"
        style={{ color: 'var(--ink-accent)', fontSize: '14px', fontFamily: 'monospace' }}
      >
{`    ${sparks}  ${sparks}
   ┌─────────┐
   │  ${eyes}  │
   │  ${mouth}  │
   └────┬────┘
  ${arms[0]}═════┼═════${arms[1]}
   ║    │    ║
        │
   ┌────┴────┐
   │ ░░░░░░░ │
   └─────────┘`}
      </pre>
      <p className="text-xs animate-pulse" style={{ color: 'var(--ink-text)' }}>
        {THINKING_MESSAGES[msgIndex]}
      </p>
      <p className="text-[10px] mt-2 font-mono" style={{ color: 'var(--ink-text-muted)' }}>
        {elapsed}s elapsed
      </p>
    </div>
  );
}

export default function AIPlannerModal({ date, onClose, onApplied }: AIPlannerModalProps) {
  const [step, setStep] = useState<'preferences' | 'loading' | 'review'>('preferences');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [energyLevel, setEnergyLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [focusBlock, setFocusBlock] = useState(90);
  const [plan, setPlan] = useState<PlanBlock[]>([]);
  const [deferred, setDeferred] = useState<{ title: string; reason: string }[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ stage: 'queued' | 'prefilter' | 'thinking'; info?: string }>({ stage: 'queued' });
  const abortRef = useRef<AbortController | null>(null);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [startingBlock, setStartingBlock] = useState<number | null>(null);
  const startByTitle = useFocusStore((s) => s.startByTitle);

  useEffect(() => {
    api<{ items: { id: string; name: string }[] }>('/workspaces').then(res => {
      setWorkspaces(res.items);
    }).catch(() => {});
  }, []);

  function cancelGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep('preferences');
  }

  async function generatePlan() {
    // Cancel any in-flight request before starting new one
    abortRef.current?.abort();

    setStep('loading');
    setError('');
    setProgress({ stage: 'queued' });

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch('/api/planner/ai/generate-plan/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          date,
          startTime,
          endTime,
          energyLevel,
          focusBlockMinutes: focusBlock,
          ...(selectedWorkspace ? { workspaceId: selectedWorkspace } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw Object.assign(new Error(err.message || 'Request failed'), { status: res.status });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: { plan: PlanBlock[]; deferred?: { title: string; reason: string }[]; taskCount?: number; message?: string } | null = null;
      let streamError: string | null = null;

      // Parse SSE: blocks separated by blank line; each block has event:/data: lines
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx: number;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          let eventName = 'message';
          let dataLine = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          let payload: any;
          try { payload = JSON.parse(dataLine); } catch { continue; }

          if (eventName === 'prefilter') {
            const b = payload.breakdown || {};
            const parts: string[] = [];
            if (b.mustDo) parts.push(`${b.mustDo} must-do`);
            if (b.goals) parts.push(`${b.goals} goal${b.goals === 1 ? '' : 's'}`);
            if (b.inProgress) parts.push(`${b.inProgress} in progress`);
            setProgress({
              stage: 'prefilter',
              info: `Found ${payload.totalScheduled} task${payload.totalScheduled === 1 ? '' : 's'}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`,
            });
          } else if (eventName === 'token') {
            setProgress({ stage: 'thinking', info: `Thinking… ${payload.count} chunks` });
          } else if (eventName === 'done') {
            finalResult = payload;
          } else if (eventName === 'error') {
            streamError = payload.message || 'Plan generation failed';
          }
        }
      }

      clearTimeout(timeoutId);

      if (streamError) {
        setError(streamError);
        setStep('preferences');
        return;
      }

      if (!finalResult || (finalResult.plan.length === 0)) {
        setError(finalResult?.message || 'No intentions to shape for this day.');
        setStep('preferences');
        return;
      }

      setPlan(finalResult.plan);
      setDeferred(finalResult.deferred ?? []);
      setTaskCount(finalResult.taskCount ?? 0);
      setStep('review');
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' || controller.signal.aborted) {
        if (step === 'loading') {
          setError('Request timed out — the AI took too long. Try again!');
          setStep('preferences');
        }
        return;
      }
      const msg = err.status === 504 || err.status === 502
        ? 'Server took too long to respond. Please try again.'
        : err.status === 429
        ? 'Too many requests — wait a moment and try again.'
        : err.status >= 500
        ? 'Server error — please try again in a moment.'
        : err.message || 'Failed to generate plan';
      setError(msg);
      setStep('preferences');
    } finally {
      abortRef.current = null;
    }
  }

  async function applyPlan() {
    setApplying(true);
    try {
      await api('/planner/ai/apply-plan', {
        method: 'POST',
        body: { date, blocks: plan },
      });
      onApplied();
    } catch (err: any) {
      setError(err.message || 'Failed to apply plan');
      setApplying(false);
    }
  }

  function removeBlock(index: number) {
    setPlan(prev => prev.filter((_, i) => i !== index));
  }

  async function handleStartBlock(blockIndex: number, taskTitle: string) {
    setStartingBlock(blockIndex);
    try {
      await startByTitle(taskTitle, 25);
      onClose();
    } catch {
      setError(`Could not find task "${taskTitle}" — apply the plan first, then start.`);
    } finally {
      setStartingBlock(null);
    }
  }

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden shadow-xl flex flex-col"
        style={{ background: 'var(--ink-card-bg)', border: '1px solid var(--ink-border)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--ink-border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-text)' }}>
              AI Plan My Day
            </h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
              {dateLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none px-1 rounded hover:opacity-60 transition-opacity"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div
              className="mb-3 px-3 py-2.5 rounded-lg text-xs flex items-start gap-2"
              style={{ background: 'color-mix(in srgb, var(--ink-blocked) 12%, transparent)', color: 'var(--ink-blocked)' }}
            >
              <span className="shrink-0 text-sm font-bold">!</span>
              <div className="flex-1">
                <p>{error}</p>
                <button
                  onClick={() => { setError(''); generatePlan(); }}
                  className="mt-1.5 text-[10px] underline underline-offset-2 opacity-80 hover:opacity-100"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {step === 'preferences' && (
            <div className="space-y-4">
              {/* Time Range */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                  Available Hours
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="text-xs px-2.5 py-1.5 rounded-md bg-transparent outline-none flex-1"
                    style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>to</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="text-xs px-2.5 py-1.5 rounded-md bg-transparent outline-none flex-1"
                    style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
                  />
                </div>
              </div>

              {/* Energy Level */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                  Energy Level
                </label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setEnergyLevel(level)}
                      className="flex-1 text-xs py-2 rounded-md transition-all duration-150 capitalize"
                      style={{
                        border: `1.5px solid ${energyLevel === level ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                        background: energyLevel === level ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                        color: energyLevel === level ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                        fontWeight: energyLevel === level ? 600 : 400,
                      }}
                    >
                      {level === 'low' ? 'Low' : level === 'medium' ? 'Medium' : 'High'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Focus Block */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                  Focus Block Length
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={30}
                    max={180}
                    step={15}
                    value={focusBlock}
                    onChange={(e) => setFocusBlock(Number(e.target.value))}
                    className="flex-1"
                    style={{ accentColor: 'var(--ink-accent)' }}
                  />
                  <span className="text-xs font-medium w-16 text-right" style={{ color: 'var(--ink-text)' }}>
                    {focusBlock} min
                  </span>
                </div>
              </div>

              {/* Workspace filter */}
              {workspaces.length > 1 && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                    Space
                  </label>
                  <select
                    value={selectedWorkspace}
                    onChange={(e) => setSelectedWorkspace(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded-md bg-transparent outline-none"
                    style={{ border: '1px solid var(--ink-border)', color: 'var(--ink-text)' }}
                  >
                    <option value="">All spaces</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Info */}
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ink-text-muted)' }}>
                The AI structures your day around must-do tasks, today's goals, and in-progress work.
                Tasks that don't fit are deferred — nothing is added or invented.
              </p>
            </div>
          )}

          {step === 'loading' && (
            <>
              <RobotAnimation />
              {progress.info && (
                <p className="text-center text-[11px] mt-1 font-mono" style={{ color: 'var(--ink-accent)' }}>
                  {progress.info}
                </p>
              )}
            </>
          )}

          {step === 'review' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
                  Suggested Schedule
                </p>
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--ink-subtle)', color: 'var(--ink-text-muted)' }}>
                  {taskCount} tasks analyzed
                </span>
              </div>

              {plan.map((block, i) => {
                const style = TYPE_STYLES[block.type] || TYPE_STYLES.focus;
                return (
                  <div
                    key={i}
                    className="flex items-stretch gap-3 group"
                  >
                    {/* Time column */}
                    <div className="w-14 shrink-0 text-right pt-2">
                      <p className="text-[11px] font-mono font-medium" style={{ color: 'var(--ink-text)' }}>
                        {block.start}
                      </p>
                      <p className="text-[9px] font-mono" style={{ color: 'var(--ink-text-muted)' }}>
                        {block.end}
                      </p>
                    </div>

                    {/* Color bar */}
                    <div
                      className="w-1 rounded-full shrink-0"
                      style={{ background: style.bg, opacity: block.type === 'break' ? 0.4 : 0.8 }}
                    />

                    {/* Content */}
                    <div
                      className="flex-1 rounded-lg px-3 py-2 transition-colors duration-100"
                      style={{
                        background: block.type === 'break'
                          ? 'color-mix(in srgb, var(--ink-border) 20%, transparent)'
                          : 'color-mix(in srgb, var(--ink-surface) 80%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--ink-border) 40%, transparent)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: style.bg, opacity: 0.9 }}>
                          {style.icon} {style.label}
                        </span>
                        <div className="flex items-center gap-1">
                          {block.type !== 'break' && block.tasks.length > 0 && (
                            <button
                              onClick={() => handleStartBlock(i, block.tasks[0])}
                              disabled={startingBlock !== null}
                              className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-opacity hover:opacity-80 disabled:opacity-40"
                              style={{ background: 'var(--ink-accent)', color: 'var(--ink-on-accent)', fontWeight: 600 }}
                              title={`Start focus on "${block.tasks[0]}"`}
                            >
                              {startingBlock === i ? '…' : '▶ Start'}
                            </button>
                          )}
                          {block.type !== 'break' && (
                            <button
                              onClick={() => removeBlock(i)}
                              className="text-[10px] px-1 opacity-0 group-hover:opacity-60 transition-opacity hover:opacity-100"
                              style={{ color: 'var(--ink-blocked)' }}
                              title="Remove block"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        {block.tasks.map((task, j) => (
                          <p key={j} className="text-xs" style={{ color: block.type === 'break' ? 'var(--ink-text-muted)' : 'var(--ink-text)' }}>
                            {task}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Deferred tasks */}
              {deferred.length > 0 && (
                <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--ink-border)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--ink-text-muted)' }}>
                    Deferred to another day
                  </p>
                  <div className="space-y-1">
                    {deferred.map((d, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 px-3 py-1.5 rounded-md"
                        style={{ background: 'color-mix(in srgb, var(--ink-border) 15%, transparent)' }}
                      >
                        <span className="text-[10px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>↗</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: 'var(--ink-text-muted)' }}>{d.title}</p>
                          {d.reason && (
                            <p className="text-[10px]" style={{ color: 'var(--ink-text-muted)', opacity: 0.7 }}>{d.reason}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--ink-border)' }}>
          {step === 'preferences' && (
            <>
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={generatePlan}
                className="text-xs px-4 py-1.5 rounded-md text-white transition-colors hover:opacity-90"
                style={{ background: 'var(--ink-accent)' }}
              >
                Generate Plan
              </button>
            </>
          )}

          {step === 'loading' && (
            <button
              onClick={cancelGeneration}
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80 ml-auto"
              style={{ color: 'var(--ink-text-muted)', border: '1px solid var(--ink-border)' }}
            >
              Cancel
            </button>
          )}

          {step === 'review' && (
            <>
              <button
                onClick={() => { setStep('preferences'); setPlan([]); setDeferred([]); setError(''); }}
                className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Regenerate
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80"
                  style={{ color: 'var(--ink-text-muted)', border: '1px solid var(--ink-border)' }}
                >
                  Discard
                </button>
                <button
                  onClick={applyPlan}
                  disabled={applying || plan.filter(b => b.type !== 'break').length === 0}
                  className="text-xs px-4 py-1.5 rounded-md text-white transition-colors hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  {applying ? 'Applying...' : 'Apply to Goals'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
