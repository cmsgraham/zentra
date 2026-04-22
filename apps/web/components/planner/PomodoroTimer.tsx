'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

type TimerMode = 'work' | 'shortBreak' | 'longBreak';

const DEFAULT_DURATIONS: Record<TimerMode, number> = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const MODE_LABELS: Record<TimerMode, string> = {
  work: 'Focus',
  shortBreak: 'Short Break',
  longBreak: 'Long Break',
};

const STORAGE_KEY = 'zentra_timer_durations';

function loadDurations(): Record<TimerMode, number> {
  if (typeof window === 'undefined') return DEFAULT_DURATIONS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        work: parsed.work ?? DEFAULT_DURATIONS.work,
        shortBreak: parsed.shortBreak ?? DEFAULT_DURATIONS.shortBreak,
        longBreak: parsed.longBreak ?? DEFAULT_DURATIONS.longBreak,
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_DURATIONS;
}

function saveDurations(d: Record<TimerMode, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

export default function PomodoroTimer() {
  const [durations, setDurations] = useState<Record<TimerMode, number>>(DEFAULT_DURATIONS);
  const [mode, setMode] = useState<TimerMode>('work');
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_DURATIONS.work);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [editingMode, setEditingMode] = useState<TimerMode | null>(null);
  const [editValue, setEditValue] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Load saved durations on mount
  useEffect(() => {
    const saved = loadDurations();
    setDurations(saved);
    setSecondsLeft(saved.work);
  }, []);

  const total = durations[mode];
  const progress = 1 - secondsLeft / total;

  const switchMode = useCallback((newMode: TimerMode) => {
    setMode(newMode);
    setSecondsLeft(durations[newMode]);
    setRunning(false);
    setEditingMode(null);
  }, [durations]);

  // Tick
  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          // Auto advance
          if (mode === 'work') {
            const next = (sessions + 1) % 4 === 0 ? 'longBreak' : 'shortBreak';
            setSessions((s) => s + 1);
            setTimeout(() => switchMode(next), 300);
          } else {
            setTimeout(() => switchMode('work'), 300);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, mode, sessions, switchMode, durations]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // SVG ring
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  const modeColor = mode === 'work'
    ? 'var(--ink-accent)'
    : mode === 'shortBreak'
      ? 'var(--ink-done)'
      : 'var(--ink-in-progress)';

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Mode tabs */}
      <div className="flex gap-1 w-full">
        {(['work', 'shortBreak', 'longBreak'] as TimerMode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className="flex-1 text-[9px] py-1 rounded transition-all duration-150 uppercase tracking-wider font-semibold"
            style={{
              background: mode === m ? modeColor : 'transparent',
              color: mode === m ? 'var(--ink-on-accent)' : 'var(--ink-text-muted)',
              opacity: mode === m ? 1 : 0.7,
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Timer ring */}
      <div className="relative" style={{ width: 130, height: 130 }}>
        <svg width="130" height="130" viewBox="0 0 130 130" className="transform -rotate-90">
          {/* Background ring */}
          <circle
            cx="65" cy="65" r={radius}
            fill="none"
            stroke="color-mix(in srgb, var(--ink-border) 40%, transparent)"
            strokeWidth="5"
          />
          {/* Progress ring */}
          <circle
            cx="65" cy="65" r={radius}
            fill="none"
            stroke={modeColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        {/* Time display — click to edit duration */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {editingMode === mode && !running ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const mins = parseInt(editValue, 10);
                if (mins > 0 && mins <= 180) {
                  const next = { ...durations, [mode]: mins * 60 };
                  setDurations(next);
                  saveDurations(next);
                  setSecondsLeft(mins * 60);
                }
                setEditingMode(null);
              }}
              className="flex flex-col items-center"
            >
              <div className="flex items-baseline gap-0.5">
                <input
                  ref={editInputRef}
                  type="number"
                  min={1}
                  max={180}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => setEditingMode(null)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingMode(null); }}
                  className="w-12 text-center text-2xl font-mono font-bold bg-transparent outline-none"
                  style={{ color: modeColor }}
                  autoFocus
                />
                <span className="text-[10px] font-medium" style={{ color: 'var(--ink-text-muted)' }}>min</span>
              </div>
            </form>
          ) : (
            <button
              onClick={() => {
                if (!running) {
                  setEditingMode(mode);
                  setEditValue(String(Math.floor(durations[mode] / 60)));
                  setTimeout(() => editInputRef.current?.select(), 50);
                }
              }}
              className="flex flex-col items-center cursor-pointer group"
              title="Click to change duration"
            >
              <span
                className="text-2xl font-mono font-bold tracking-tight group-hover:opacity-70 transition-opacity"
                style={{ color: 'var(--ink-text)' }}
              >
                {timeStr}
              </span>
              <span className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                {MODE_LABELS[mode]}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setRunning(!running)}
          className="text-[11px] px-4 py-1.5 rounded-full font-medium transition-all duration-150"
          style={{
            background: running ? 'transparent' : modeColor,
            color: running ? modeColor : 'var(--ink-on-accent)',
            border: running ? `1.5px solid ${modeColor}` : '1.5px solid transparent',
          }}
        >
          {running ? 'Pause' : secondsLeft < total ? 'Resume' : 'Start'}
        </button>
        {(running || secondsLeft < total) && (
          <button
            onClick={() => { setSecondsLeft(durations[mode]); setRunning(false); }}
            className="text-[10px] px-2 py-1 rounded transition-colors duration-100"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Session counter */}
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-2.5 h-2.5 rounded-full transition-all duration-200"
            style={{
              background: i < (sessions % 4) ? modeColor : 'color-mix(in srgb, var(--ink-border) 50%, transparent)',
            }}
          />
        ))}
        <span className="text-[9px] ml-1" style={{ color: 'var(--ink-text-muted)' }}>
          {sessions} session{sessions !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
