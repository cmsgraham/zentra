'use client';

import { useMemo } from 'react';

export interface CalendarDayData {
  date: string;
  hasPlanner: boolean;
  appointmentCount: number;
  deadlineCount: number;
}

interface Props {
  year: number;
  month: number; // 0-indexed
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  dayData?: CalendarDayData[];
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toIso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function MiniCalendar({ year, month, selectedDate, onSelectDate, onPrevMonth, onNextMonth, dayData }: Props) {
  const today = new Date().toLocaleDateString('en-CA');

  const dataMap = useMemo(() => {
    const map = new Map<string, CalendarDayData>();
    dayData?.forEach((d) => map.set(d.date, d));
    return map;
  }, [dayData]);

  // Build calendar grid
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells: { day: number; iso: string; inMonth: boolean }[] = [];

  // leading days from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    cells.push({ day: d, iso: toIso(py, pm, d), inMonth: false });
  }
  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: toIso(year, month, d), inMonth: true });
  }
  // trailing days
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, iso: toIso(ny, nm, d), inMonth: false });
    }
  }

  return (
    <div className="select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <button
          type="button"
          onClick={onPrevMonth}
          className="px-1.5 py-0.5 rounded text-xs hover:opacity-70 transition-opacity duration-150"
          style={{ color: 'var(--ink-text-muted)' }}
        >
          ‹
        </button>
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-text-muted)' }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          className="px-1.5 py-0.5 rounded text-xs hover:opacity-70 transition-opacity duration-150"
          style={{ color: 'var(--ink-text-muted)' }}
        >
          ›
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="text-center text-[10px] font-medium py-0.5" style={{ color: 'var(--ink-text-muted)', opacity: 0.7 }}>
            {wd}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((cell, i) => {
          const isSelected = cell.iso === selectedDate;
          const isToday = cell.iso === today;
          const dd = dataMap.get(cell.iso);
          const hasMarkers = dd && (dd.hasPlanner || dd.appointmentCount > 0 || dd.deadlineCount > 0);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDate(cell.iso)}
              className="relative flex flex-col items-center justify-center h-7 rounded text-[11px] transition-all duration-100"
              style={{
                color: !cell.inMonth
                  ? 'var(--ink-border)'
                  : isSelected
                    ? 'var(--ink-on-accent)'
                    : isToday
                      ? 'var(--ink-accent)'
                      : 'var(--ink-text)',
                background: isSelected ? 'var(--ink-accent)' : 'transparent',
                fontWeight: isToday || isSelected ? 700 : 400,
              }}
            >
              <span>{cell.day}</span>
              {/* Dot indicators */}
              {hasMarkers && cell.inMonth && (
                <div className="flex gap-px absolute bottom-0.5">
                  {dd.deadlineCount > 0 && (
                    <span className="w-1 h-1 rounded-full" style={{ background: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--ink-blocked)' }} />
                  )}
                  {dd.appointmentCount > 0 && (
                    <span className="w-1 h-1 rounded-full" style={{ background: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--ink-accent)' }} />
                  )}
                  {dd.hasPlanner && (
                    <span className="w-1 h-1 rounded-full" style={{ background: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--ink-done)' }} />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-2 mt-1 justify-center">
        <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>
          <span className="w-1 h-1 rounded-full inline-block" style={{ background: 'var(--ink-blocked)' }} /> Due
        </span>
        <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>
          <span className="w-1 h-1 rounded-full inline-block" style={{ background: 'var(--ink-accent)' }} /> Appt
        </span>
        <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>
          <span className="w-1 h-1 rounded-full inline-block" style={{ background: 'var(--ink-done)' }} /> Plan
        </span>
      </div>
    </div>
  );
}
