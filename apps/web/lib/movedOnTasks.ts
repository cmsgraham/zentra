/**
 * Per-day "moved on" task tracker.
 *
 * When a user taps "Move on" from a focus session, we remember the task title
 * for the rest of that day so downstream prompts (e.g. CompactNextUp) don't
 * immediately surface the same task again. Scoped to localStorage by date.
 */

const KEY_PREFIX = 'zentra:movedOn:';

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function keyFor(date: string): string {
  return `${KEY_PREFIX}${date}`;
}

function read(date: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(keyFor(date));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function write(date: string, set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(date), JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function addMovedOnTask(title: string, date: string = todayLocal()): void {
  const s = read(date);
  s.add(title);
  write(date, s);
}

export function hasMovedOnTask(title: string, date: string = todayLocal()): boolean {
  return read(date).has(title);
}

export function listMovedOnTasks(date: string = todayLocal()): Set<string> {
  return read(date);
}
